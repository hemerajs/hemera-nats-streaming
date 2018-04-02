'use strict'

const Hp = require('hemera-plugin')
// eslint-disable-next-line node/no-unpublished-require
const SafeStringify = require('nats-hemera/lib/encoder').encode
// eslint-disable-next-line node/no-unpublished-require
const SafeParse = require('nats-hemera/lib/decoder').decode
const Nats = require('node-nats-streaming')

function hemeraNatsStreaming(hemera, opts, done) {
  const topic = 'natss'
  const Joi = hemera.joi
  const ParsingError = hemera.createError('ParsingError')
  const clientId = opts.clientId || hemera.config.name
  const stan =
    opts.natssInstance || Nats.connect(opts.clusterId, clientId, opts.options)
  const subs = new Map()

  hemera.decorate('natss', {
    ParsingError
  })

  hemera.ext('onClose', (ctx, done) => {
    hemera.log.debug('Stan closing ...')
    stan.close()
    done()
  })

  stan.on('error', err => {
    hemera.log.error(err)
    hemera.fatal()
  })

  stan.on('connect', function() {
    /**
     * Publish a message over NATS-Streaming server
     */
    hemera.add(
      {
        topic,
        cmd: 'publish',
        subject: Joi.string().required(),
        data: Joi.alternatives().try(Joi.object(), Joi.array())
      },
      function(req, reply) {
        const result = SafeStringify(req.data)

        if (result.error) {
          const error = new ParsingError(
            `Message could not be stringified. Subject "${req.subject}"`
          ).causedBy(result.error)
          this.log.error(error)
          reply(error)
        } else {
          stan.publish(req.subject, result.value, function publishHandler(
            err,
            guid
          ) {
            if (err) {
              reply(err)
            } else {
              reply(null, guid)
            }
          })
        }
      }
    )

    /**
     * Create a subscription on the NATS-Streaming server
     * Manual acknowledgement is handled by request / reply call to NATS
     */
    hemera.add(
      {
        topic,
        cmd: 'subscribe',
        subject: Joi.string().required(),
        queue: Joi.string().optional(), // queue group name
        options: Joi.object()
          .keys({
            setStartWithLastReceived: Joi.boolean(), // Subscribe starting with the most recently published value
            setDeliverAllAvailable: Joi.boolean(), // Receive all stored values in order
            setStartAtSequence: Joi.number().integer(), // Receive all messages starting at a specific sequence number
            setStartTime: Joi.date().iso(), // Subscribe starting at a specific time
            setStartAtTimeDelta: Joi.number().integer(),
            setDurableName: Joi.string(), // Create a durable subscription
            setMaxInFlight: Joi.number().integer(), // the maximum number of outstanding acknowledgements
            setManualAckMode: Joi.boolean().default(true),
            setAckWait: Joi.number().integer() // if an acknowledgement is not received within the configured timeout interval, NATS Streaming will attempt redelivery of the message (default 30 seconds)
          })
          .default()
          .unknown(false)
      },
      function(req, reply) {
        const opts = stan.subscriptionOptions()

        // build subscription options
        for (var option in req.options) {
          if (req.options[option] !== undefined) {
            opts[option](req.options[option])
          }
        }

        this.log.debug(
          opts,
          `Create subscription with subject '${req.subject}'`
        )

        const sub = stan.subscribe(req.subject, req.queue, opts)
        subs.set(sub.inboxSub, sub)

        sub.on('message', msg => {
          const result = SafeParse(msg.getData())
          const hemeraTopic = topic + '.' + req.subject

          if (result.error) {
            const error = new ParsingError(
              `Message could not be parsed as JSON. Subject '${req.subject}'`
            ).causedBy(result.error)
            this.log.error(error)
          } else {
            const data = {
              sequence: msg.getSequence(),
              message: result.value
            }

            hemera.act(
              {
                topic: hemeraTopic,
                data
              },
              function(err, resp) {
                if (!err) {
                  msg.ack()
                } else {
                  this.log.error(
                    `Message could not be acknowledged. Subscription with topic '${hemeraTopic}'`
                  )
                }
              }
            )
          }
        })

        const subTopic = `${topic}.subs.${sub.inboxSub}`

        /**
         * Create a server action to suspend an active subscription
         */
        hemera.add(
          {
            topic: subTopic,
            cmd: 'suspend'
          },
          function(req, reply) {
            subs.get(sub.inboxSub).close()
            subs.get(sub.inboxSub).once('closed', () => {
              subs.delete(sub.inboxSub)
              // unsubscribe and remove patterns
              hemera.remove(subTopic)
              reply(null, true)
            })
          }
        )

        /**
         * Create a server action to unsubscribe a subscription
         */
        hemera.add(
          {
            topic: subTopic,
            cmd: 'unsubscribe'
          },
          function(req, reply) {
            subs.get(sub.inboxSub).unsubscribe()
            subs.get(sub.inboxSub).once('unsubscribed', () => {
              subs.delete(sub.inboxSub)
              // unsubscribe and remove patterns
              hemera.remove(subTopic)
              reply(null, true)
            })
          }
        )

        // we don't use always the same connection so we have to ensure that the subs were created
        hemera.transport.flush(() => {
          this.log.debug(
            `Force flush for subscription with subject '${
              req.subject
            }' and subId ${sub.inboxSub}`
          )
          reply(null, { subject: req.subject, opts, subId: sub.inboxSub })
        })
      }
    )

    done()
  })
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '^5.0.0',
  name: require('./package.json').name,
  depdendencies: ['hemera-joi']
})

module.exports = plugin
