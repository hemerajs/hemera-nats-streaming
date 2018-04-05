'use strict'

const Hemera = require('nats-hemera')
const nats = require('nats').connect()
const hemeraNatsStreaming = require('./../')

const hemera = new Hemera(nats, {
  logLevel: 'debug',
  childLogger: true
})
hemera.use(hemeraNatsStreaming, {
  clusterId: 'test-cluster',
  clientId: 'test-client',
  options: {} // NATS/STAN options
})

const topic = 'natss'
const subject = 'news'

hemera.ready(() => {
  /**
   * Create nats-streaming subscription
   */
  const sub = hemera.natsStreaming.add({
    subject
  })

  /*
  * Send message to nats-streaming
  */
  hemera
    .act({
      topic,
      cmd: 'publish',
      subject,
      data: {
        a: 1
      }
    })
    .then(() => sub.unsubscribe())
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
