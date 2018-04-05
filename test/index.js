'use strict'

const Hemera = require('nats-hemera')
const Nats = require('nats')
const NatsStreaming = require('node-nats-streaming')
const HemeraNatsStreaming = require('./../')
const Code = require('code')
const HemeraTestsuite = require('hemera-testsuite')
const ssc = require('./support/stan_server_control')

const os = require('os')
const path = require('path')
const nuid = require('nuid')
const timers = require('timers')

const expect = Code.expect

describe('Hemera-nats-streaming', function() {
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
          natssInstance = NatsStreaming.connect(clusterId, clientId)
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
    hemera.close()
    server.kill()
  })

  it('Subscribe', function(done) {
    const subject = 'orderCreated1'
    const sub = hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })
    expect(sub.subject).to.be.equals(subject)
    expect(sub.opts.manualAcks).to.be.equals(true)
    done()
  })

  it('Can not subscribe the same subject twice', function() {
    const subject = 'orderCreated2'
    hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })

    try {
      hemera.natsStreaming.add({
        cmd: 'subscribe',
        subject
      })
    } catch (err) {
      expect(err).to.be.exists()
      expect(err.message).to.be.equals(
        "Subject 'string' can only be subscribed once on this client"
      )
    }
  })

  it('Subscribe with options', function(done) {
    const subject = 'orderCreated3'
    const sub = hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject,
      options: {
        durableName: 'test'
      }
    })
    expect(sub.subject).to.be.equals(subject)
    expect(sub.opts.manualAcks).to.be.equals(true)
    expect(sub.opts.durableName).to.be.equals('test')
    done()
  })

  it('Subscribe and unsubscribe', function(done) {
    const subject = 'orderCreated4'
    const sub = hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })
    sub.unsubscribe()
    done()
  })

  it('Subscribe, suspend and subscribe', function(done) {
    const subject = 'orderCreated5'
    const sub = hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })
    sub.close()
    hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })
    done()
  })

  it('Publish and subscribe', function(done) {
    const subject = 'orderCreated6'

    hemera.add(
      {
        topic: `${topic}.${subject}`
      },
      (req, cb) => {
        expect(req.data.message).to.be.equals({ foo: 'bar' })
        expect(req.data.sequence).to.be.number()
        cb()
        done()
      }
    )

    hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject
    })
    hemera
      .act({
        topic,
        cmd: 'publish',
        subject,
        data: { foo: 'bar' }
      })
      .catch(done)
  })

  it('Publish and subscribe with custom request pattern', function(done) {
    const subject = 'orderCreated7'

    hemera.add(
      {
        topic: `${topic}.${subject}`
      },
      (req, cb) => {
        expect(req.data.message).to.be.equals({ foo: 'bar' })
        expect(req.data.sequence).to.be.number()
        expect(req.a).to.be.number()
        cb()
        done()
      }
    )

    hemera.natsStreaming.add({
      cmd: 'subscribe',
      subject,
      pattern: { a: 1 }
    })
    hemera
      .act({
        topic,
        cmd: 'publish',
        subject,
        data: { foo: 'bar' }
      })
      .catch(done)
  })

  it('Should expose errors', function(done) {
    expect(hemera.natss.ParseError).to.be.exists()
    done()
  })
})
