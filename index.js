'use strict'

const Hp = require('hemera-plugin')
// eslint-disable-next-line node/no-unpublished-require
const SafeStringify = require('nats-hemera/lib/encoder').encode
// eslint-disable-next-line node/no-unpublished-require
const SafeParse = require('nats-hemera/lib/decoder').decode
const Nats = require('node-nats-streaming')

function hemeraNatsStreaming(hemera, opts, done) {
  const topic = 'natss'
  const ParseError = hemera.createError('ParseError')
  const clientId = opts.clientId || hemera.config.name
  const stan =
    opts.natssInstance || Nats.connect(opts.clusterId, clientId, opts.options)
  const subs = new Map()

  hemera.decorate('natss', {
    ParseError
  })

  hemera.ext('onClose', (hemera, done) => {
    hemera.log.debug('nats-streaming closing ...')
    done()
  })

  stan.on('error', err => {
    hemera.log.error(err, 'stan error')
    hemera.close(() => stan.close())
  })

  stan.on('connect', function() {
    /**
     * Publish a message over NATS-Streaming server
     */
    hemera.add(
      {
        topic,
        cmd: 'publish'
      },
      function(req, reply) {
        if (typeof req.subject !== 'string') {
          reply(
            new Error(
              `Subject must be from type 'string' but got '${typeof req.subject}'`
            )
          )
          return
        }
        if (!Array.isArray(req.data) && typeof req.data !== 'object') {
          reply(
            new Error(
              `Data must be from type 'object' or 'array' but got '${typeof req.data}'`
            )
          )
          return
        }

        const result = SafeStringify(req.data)

        if (result.error) {
          const error = new ParseError(
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
        cmd: 'subscribe'
      },
      function(req, reply) {
        if (typeof req.subject !== 'string') {
          reply(
            new Error(
              `Subject must be from type 'string' but got '${typeof req.subject}'`
            )
          )
          return
        }

        const opts = stan.subscriptionOptions()
        opts.setManualAckMode(true)

        // build subscription options
        for (let option in req.options) {
          if (req.options[option] && opts[option]) {
            opts[option](req.options[option])
          }
        }

        const sub = stan.subscribe(req.subject, req.queue, opts)
        subs.set(sub.inboxSub, sub)

        this.log.debug(
          opts,
          `Create subscription with subject '${req.subject}' and subId ${
            sub.inboxSub
          }`
        )

        sub.on('message', msg => {
          const result = SafeParse(msg.getData())
          const hemeraTopic = topic + '.' + req.subject

          if (result.error) {
            const error = new ParseError(
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
              // clean subscription and patterns from hemera
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
              // clean subscription and patterns from hemera
              hemera.remove(subTopic)
              reply(null, true)
            })
          }
        )

        // force flush to make suspend and unususcribe action available
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
  })

  done()
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '^5.0.0',
  name: require('./package.json').name
})

module.exports = plugin
