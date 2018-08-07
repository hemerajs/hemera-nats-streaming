'use strict'

const Hemera = require('nats-hemera')
const Nats = require('nats')
const NatsStreaming = require('node-nats-streaming')
const HemeraNatsStreaming = require('./../')
const Code = require('code')
const ssc = require('./support/stan_server_control')

const os = require('os')
const path = require('path')
const nuid = require('nuid')
const timers = require('timers')

const expect = Code.expect

describe('Hemera-nats-streaming graceful shutdown', function() {
  let PORT = 4222
  let clusterId = 'test-cluster'
  let clientId = 'test-client'
  let uri = 'nats://localhost:' + PORT
  const topic = 'natss'
  let server
  let hemera
  let natssInstance

  let serverDir = path.join(os.tmpdir(), nuid.next())

  before(function(done) {
    server = ssc.start_server(
      PORT,
      ['--store', 'FILE', '--dir', serverDir],
      function() {
        // wait until server is ready
        timers.setTimeout(function() {
          const nats = Nats.connect()
          natssInstance = NatsStreaming.connect(
            clusterId,
            clientId
          )
          hemera = new Hemera(nats, {
            logLevel: 'error'
          })
          hemera.use(HemeraNatsStreaming, {
            natssInstance
          })
          hemera.ready(() => hemera.transport.flush(done))
        }, 250)
      }
    )
  })

  after(function() {
    server.kill()
  })

  it('Should close the connection', function(done) {
    hemera.close(() => {
      expect(natssInstance.isClosed()).to.be.equals(true)
      done()
    })
  })
})
