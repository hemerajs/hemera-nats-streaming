'use strict'

const Hp = require('hemera-plugin')
const SafeStringify = require('nats-hemera/lib/encoder').encode
const SafeParse = require('nats-hemera/lib/decoder').decode
const Nats = require('node-nats-streaming')

function hemeraNatsStreaming(hemera, opts, done) {
  const topic = 'nats-streaming'
  const Joi = hemera.joi
  const DuplicateSubscriberError = hemera.createError('DuplicateSubscriber')
  const ParsingError = hemera.createError('ParsingError')
  const NotAvailableError = hemera.createError('NotAvailable')
  const stan = Nats.connect(opts.clusterId, opts.clientId, opts.opts)
  const subList = new Map()

  hemera.decorate('natsStreaming', {
    errors: {
      DuplicateSubscriberError,
      ParsingError,
      NotAvailableError
    }
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
        function handler(err, guid) {
          if (err) {
            reply(err)
          } else {
            reply(null, guid)
          }
        }

        const result = SafeStringify(req.data)

        if (result.error) {
          const error = new ParsingError(
            `Message could not be stringified. Subject "${req.subject}"`
          ).cause(result.error)
          this.log.error(error)
          reply(error)
        } else {
          stan.publish(req.subject, result.value, handler)
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
      },
      function(req, reply) {
        // avoid multiple subscribers for the same subject
        if (subList.has(req.subject)) {
          reply(
            new DuplicateSubscriberError(
              `Subscription for subject "${req.subject}" is already active`
            )
          )
          return
        }

        const opts = stan.subscriptionOptions()

        // construct subscription options
        for (var option in req.options) {
          if (req.options[option] !== undefined) {
            opts[option](req.options[option])
          }
        }

        this.log.debug(opts, 'Subscription options')

        const sub = stan.subscribe(req.subject, req.queue, opts)
        subList.set(req.subject, sub)

        sub.on('message', msg => {
          const result = SafeParse(msg.getData())
          const inboxChannel = topic + '.' + req.subject

          if (result.error) {
            const error = new ParsingError(
              `Message could not be parsed as JSON. Subject "${req.subject}"`
            ).cause(result.error)
            this.log.error(error)
          } else {
            const data = {
              sequence: msg.getSequence(),
              message: result.value
            }

            hemera.act(
              {
                topic: inboxChannel,
                data
              },
              function(err, resp) {
                if (!err) {
                  msg.ack()
                } else {
                  this.log.error(
                    `Message could not be acknowledged. Subscription "${inboxChannel}"`
                  )
                }
              }
            )
          }
        })

        // signal that subscription was created
        reply(null, { created: true, subject: req.subject, opts })
      }
    )

    /**
     * Suspends durable subscription
     * If you call `subscribe` again the subscription will be resumed
     */
    hemera.add(
      {
        topic,
        cmd: 'suspend',
        subject: Joi.string().required()
      },
      function(req, reply) {
        if (subList.has(req.subject)) {
          subList.get(req.subject).close()
          subList.delete(req.subject)
          reply(null, true)
        } else {
          reply(
            new NotAvailableError(
              `Subscription "${req.subject}" is not available`
            )
          )
        }
      }
    )

    /**
     * Unsubscribe an active subscription
     */
    hemera.add(
      {
        topic,
        cmd: 'unsubscribe',
        subject: Joi.string().required()
      },
      function(req, reply) {
        if (subList.has(req.subject)) {
          subList.get(req.subject).unsubscribe()
          subList.delete(req.subject)
          reply(null, true)
        } else {
          reply(
            new NotAvailableError(
              `Subscription "${req.subject}" is not available`
            )
          )
        }
      }
    )

    done()
  })
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '>=3',
  name: require('./package.json').name,
  depdendencies: ['hemera-joi'],
  options: {
    payloadValidator: 'hemera-joi',
    opts: {} // object with NATS/STAN options
  }
})

module.exports = plugin
