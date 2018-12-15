'use strict'

const Hp = require('hemera-plugin')
const SafeStringify = require('nats-hemera/lib/encoder').encode
const SafeParse = require('nats-hemera/lib/decoder').decode
const Nats = require('node-nats-streaming')

function hemeraNatsStreaming(hemera, opts, done) {
  const topic = 'natss'
  const ParseError = hemera.createError('ParseError')
  let connected = false
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
    stan = Nats.connect(
      clusterId,
      clientId,
      opts.options
    )
  }

  hemera.decorate('natss', {
    add: addSubscription,
    ParseError
  })

  hemera.ext('onClose', onClose)
  stan.on('error', onError)
  stan.on('connect', onConnect)

  function onClose(hemera, done) {
    hemera.log.debug('nats-streaming closing ...')
    stan.once('close', () => {
      hemera.log.debug('nats-streaming nats connection closed')
      done()
    })
    stan.close()
  }

  function onError(err) {
    if (connected === false) {
      done(err)
    }
    hemera.log.error(err, 'stan error')
  }

  function onConnect() {
    connected = true
    hemera
      .add({
        topic,
        cmd: 'publish'
      })
      .use(validateRequest)
      .end((req, reply) => {
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
      })
    done()
  }

  function validateRequest(req, reply, next) {
    const pattern = req.payload.pattern
    if (typeof pattern.subject !== 'string') {
      const error = new Error(
        `Subject must be from type 'string' but got '${typeof pattern.subject}'`
      )
      next(error)
      return
    }
    if (!Array.isArray(pattern.data) && typeof pattern.data !== 'object') {
      const error = new Error(
        `Data must be from type 'object' or 'array' but got '${typeof pattern.data}'`
      )
      next(error)
      return
    }
    next()
  }

  function addSubscription(subDef) {
    if (typeof subDef.subject !== 'string' || !subDef.subject) {
      throw new Error(
        `Subject must be not empty and from type 'string' but got '${typeof subDef.subject}'`
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
}

const plugin = Hp(hemeraNatsStreaming, {
  hemera: '>=5.0.0',
  name: require('./package.json').name
})

module.exports = plugin
