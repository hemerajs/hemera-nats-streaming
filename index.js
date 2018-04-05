'use strict'

const Hp = require('hemera-plugin')
const SafeStringify = require('nats-hemera/lib/encoder').encode
const SafeParse = require('nats-hemera/lib/decoder').decode
const Nats = require('node-nats-streaming')

function hemeraNatsStreaming(hemera, opts, done) {
  const topic = 'natss'
  const ParseError = hemera.createError('ParseError')
  let clientId
  let clusterId
  let stan

  if (opts.natssInstance) {
    clientId = opts.natssInstance.clientID
    clusterId = opts.natssInstance.clusterID
    stan = opts.natssInstance
  } else {
    clientId = opts.clientId
    clusterId = opts.clusterId
    stan = Nats.connect(clusterId, clientId, opts.options)
  }

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
            let pattern = {
              topic: hemeraTopic,
              data: {
                sequence: msg.getSequence(),
                message: result.value
              }
            }
            if (typeof req.pattern === 'object') {
              pattern = Object.assign(req.pattern, pattern)
            }
            hemera.act(pattern, (err, resp) => {
              if (!err) {
                msg.ack()
              } else {
                hemera.log.error(
                  `Message could not be acknowledged. Subscription with topic '${hemeraTopic}'`
                )
              }
            })
          }
        })

        reply(null, {
          subject: req.subject,
          queue: req.queue,
          options: opts
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
        const sub = subs.get(req.subject)
        if (sub) {
          sub.close()
          subs.delete(req.subject)
          reply(null, true)
        } else {
          reply(new Error('Subscription could not be found'))
        }
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
        const sub = subs.get(req.subject)
        if (sub) {
          sub.unsubscribe()
          subs.delete(req.subject)
          reply(null, true)
        } else {
          reply(new Error('Subscription could not be found'))
        }
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
            queue: sub.qGroup,
            options: sub.opts
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
