'use strict'

const Hemera = require('nats-hemera')
const nats = require('nats').connect()
const hemeraNatsStreaming = require('./../')

const hemera = new Hemera(nats, {
  logLevel: 'debug',
  childLogger: true
})
const clientId = 'test-client'
const clusterId = 'test-cluster'
hemera.use(hemeraNatsStreaming, {
  clusterId,
  clientId,
  options: {} // NATS/STAN options
})

const topic = 'natss'

hemera.ready(() => {
  /**
   * Create nats-streaming-subscription
   */
  const subject = 'news'

  hemera.natsStreaming.add({
    subject
  })

  hemera
    .act({
      topic,
      cmd: 'publish',
      subject,
      data: {
        a: 1
      }
    })
    .then(() =>
      hemera.act({
        topic: `${topic}.clients.${clientId}`,
        cmd: 'unsubscribe',
        subject
      })
    )
    .catch(err => console.error(err))

  /**
   * Add listener for nats-streaming events
   */
  hemera.add(
    {
      topic: `${topic}.${subject}`
    },
    function(req, reply) {
      this.log.info(req, 'RECEIVED')
      // ACK Message, if you pass an error the message is redelivered every 10 seconds
      reply()
      // reply(new Error('test'))
    }
  )
})
