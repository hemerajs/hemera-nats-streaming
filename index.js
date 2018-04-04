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
  const clientId = opts.clientId
  const clusterId = opts.clusterId
  const stan =
    opts.natssInstance || Nats.connect(clusterId, clientId, opts.options)
  const subs = new Map()
  let connected = false

  hemera.decorate('natss', {
    ParseError
  })

  hemera.ext('onClose', (hemera, done) => {
    hemera.log.debug('nats-streaming closing ...')
    done()
  })

  stan.on('error', err => {
    if (connected === false) {
      done(err)
    }
    hemera.log.error(err, 'stan error')
    hemera.close(() => stan.close())
  })

  stan.on('connect', boot)

  function boot() {
    hemera.add(
      {
        topic,
        cmd: 'publish'
      },
      (req, reply) => {
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
          hemera.log.error(error)
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

    hemera.add(
      {
        topic,
        cmd: 'subscribe'
      },
      (req, reply) => {
        if (typeof req.subject !== 'string' || !req.subject) {
          reply(
            new Error(
              `Subject must be not empty and from type 'string' but got '${typeof req.subject}'`
            )
          )
          return
        }

        const opts = stan.subscriptionOptions()
        opts.setManualAckMode(true)

        // build subscription options
        for (let option in req.options) {
          const setterName = 'set' + option[0].toUpperCase() + option.slice(1)
          if (req.options[option] && typeof opts[setterName] === 'function') {
            opts[setterName](req.options[option])
          }
        }

        const sub = stan.subscribe(req.subject, req.queue, opts)
        subs.set(req.subject, sub)

        hemera.log.debug(
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
            hemera.log.error(error)
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
              (err, resp) => {
                if (!err) {
                  msg.ack()
                } else {
                  hemera.log.error(
                    `Message could not be acknowledged. Subscription with topic '${hemeraTopic}'`
                  )
                }
              }
            )
          }
        })

        reply(null, {
          subject: req.subject,
          durableName: opts.durableName,
          manualAcks: opts.manualAcks
        })
      }
    )

    hemera.add(
      {
        topic: `${topic}.clients.${clientId}`,
        cmd: 'suspend'
      },
      (req, reply) => {
        if (typeof req.subject !== 'string' || !req.subject) {
          reply(
            new Error(
              `Subject must be not empty and from type 'string' but got '${typeof req.subject}'`
            )
          )
          return
        }
        subs.get(req.subject).close()
        subs.get(req.subject).once('closed', () => {
          subs.delete(req.subject)
          reply(null, true)
        })
      }
    )

    hemera.add(
      {
        topic: `${topic}.clients.${clientId}`,
        cmd: 'unsubscribe'
      },
      (req, reply) => {
        if (typeof req.subject !== 'string' || !req.subject) {
          reply(
            new Error(
              `Subject must be not empty and from type 'string' but got '${typeof req.subject}'`
            )
          )
          return
        }
        subs.get(req.subject).unsubscribe()
        subs.get(req.subject).once('unsubscribed', () => {
          subs.delete(req.subject)
          reply(null, true)
        })
      }
    )

    hemera.add(
      {
        topic: `${topic}.clients.${clientId}`,
        cmd: 'list'
      },
      (req, reply) => {
        let list = []
        for (const sub of subs.values()) {
          list.push({
            subject: sub.subject,
            durableName: sub.opts.durableName,
            manualAcks: sub.opts.manualAcks
          })
        }
        reply(null, list)
      }
    )

    connected = true
    done()
  }
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '^5.0.0',
  name: require('./package.json').name
})

module.exports = plugin
