'use strict'

const Hemera = require('nats-hemera')
const Nats = require('nats')
const HemeraNatsStreaming = require('./../')
const HemeraJoi = require('hemera-joi')
const Code = require('code')
const HemeraTestsuite = require('hemera-testsuite')
const ssc = require('./support/stan_server_control')

const net = require('net')
const os = require('os')
const path = require('path')
const nuid = require('nuid')

const expect = Code.expect

describe('Hemera-nats-streaming', function() {
  let PORT = 4222
  let cluster = 'test-cluster'
  let uri = 'nats://localhost:' + PORT
  let server
  let hemera

  let serverDir = path.join(os.tmpdir(), nuid.next())

  before(function(done) {
    server = ssc.start_server(
      PORT,
      ['--store', 'FILE', '--dir', serverDir],
      function() {
        setTimeout(function() {
          const nats = Nats.connect()
          hemera = new Hemera(nats, {
            logLevel: 'info'
          })
          hemera.use(HemeraJoi)
          hemera.use(HemeraNatsStreaming, {
            clusterId: cluster,
            clientId: 'clientTest',
            opts: {}
          })
          hemera.ready(() => {
            done()
          })
        }, 250)
      }
    )
  })

  after(function() {
    hemera.close()
    server.kill()
  })

  it('Connect', function(done) {
    hemera.act(
      {
        topic: 'nats-streaming',
        cmd: 'subscribe',
        subject: 'orderCreated',
        options: {
          setAckWait: 10000,
          setDeliverAllAvailable: true,
          setDurableName: 'orderCreated'
        }
      },
      function(err, resp) {
        expect(err).to.be.not.exists()
        expect(resp.created).to.be.equals(true)
        expect(resp.opts).to.be.exists()
        expect(resp.subject).to.be.equals('orderCreated')
        done()
      }
    )
  })
})
