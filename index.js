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

  function addSubscription(subDef) {
    if (typeof subDef.subject !== 'string' || !subDef.subject) {
      throw new Error(
        `Subject must be not empty and from type 'string' but got '${typeof subDef.subject}'`
      )
    }

    if (subs.has(subDef.subject)) {
      throw new Error(
        `Subject '${typeof subDef.subject}' can only be subscribed once on this client`
      )
    }

    const opts = stan.subscriptionOptions()
    opts.setManualAckMode(true)

    // build subscription options
    for (let option in subDef.options) {
      const setterName = 'set' + option[0].toUpperCase() + option.slice(1)
      if (subDef.options[option] && typeof opts[setterName] === 'function') {
        opts[setterName](subDef.options[option])
      }
    }

    const sub = stan.subscribe(subDef.subject, subDef.queue, opts)
    subs.set(subDef.subject, sub)

    hemera.log.debug(
      opts,
      `Create subscription with subject '${subDef.subject}' and subId ${
        sub.inboxSub
      }`
    )

    sub.on('message', msg => {
      const result = SafeParse(msg.getData())
      if (result.error) {
        const error = new ParseError(
          `Message could not be parsed as JSON. Subject '${subDef.subject}'`
        ).causedBy(result.error)
        hemera.log.error(error)
      } else {
        let pattern = {
          topic: `${topic}.${subDef.subject}`,
          data: {
            sequence: msg.getSequence(),
            message: result.value
          }
        }
        if (typeof subDef.pattern === 'object') {
          pattern = Object.assign(subDef.pattern, pattern)
        }
        hemera.act(pattern, (err, resp) => {
          if (!err) {
            msg.ack()
          } else {
            hemera.log.error(
              `Message could not be acknowledged. Subscription with topic '${topic}.${
                subDef.subject
              }'`
            )
          }
        })
      }
    })

    return sub
  }

  hemera.decorate('natsStreaming', {
    add: addSubscription
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
    connected = true
    done()
  }
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '^5.0.0',
  name: require('./package.json').name
})

module.exports = plugin
