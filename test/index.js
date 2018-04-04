'use strict'

const Hemera = require('nats-hemera')
const Nats = require('nats')
const HemeraNatsStreaming = require('./../')
const Code = require('code')
const HemeraTestsuite = require('hemera-testsuite')
const ssc = require('./support/stan_server_control')

const net = require('net')
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

  let serverDir = path.join(os.tmpdir(), nuid.next())

  before(function(done) {
    server = ssc.start_server(
      PORT,
      ['--store', 'FILE', '--dir', serverDir],
      function() {
        // wait until server is ready
        timers.setTimeout(function() {
          const nats = Nats.connect()
          hemera = new Hemera(nats, {
            logLevel: 'debug'
          })
          hemera.use(HemeraNatsStreaming, {
            clusterId,
            clientId
          })
          hemera.ready(done)
        }, 250)
      }
    )
  })

  after(function() {
    hemera.close()
    server.kill()
  })

  it('Subscribe', function(done) {
    const subject = 'orderCreated'
    hemera.act(
      {
        topic,
        cmd: 'subscribe',
        subject
      },
      function(err, resp) {
        expect(err).to.be.not.exists()
        expect(resp.opts).to.be.exists()
        expect(resp.subject).to.be.equals(subject)
        expect(resp.subId).to.be.exists()
        expect(resp.clientId).to.be.equals(clientId)
        expect(resp.clusterId).to.be.equals(clusterId)
        done()
      }
    )
  })

  it('Subscribe and unsubscribe', function(done) {
    const subject = 'orderCreated2'
    hemera.act(
      {
        topic,
        cmd: 'subscribe',
        subject
      },
      function(err, resp) {
        expect(err).to.be.not.exists()
        expect(resp.opts).to.be.exists()
        expect(resp.subject).to.be.equals(subject)
        expect(resp.subId).to.be.exists()
        // after subscription two server actions are added suspend and unsubscribe
        expect(hemera.topics.has(`${topic}.clients.${clientId}`)).to.be.equals(
          true
        )

        hemera.act(
          {
            topic: `${topic}.clients.${clientId}`,
            cmd: 'unsubscribe',
            subject
          },
          function(err, resp) {
            expect(err).to.be.not.exists()
            expect(resp).to.be.equals(true)
            done()
          }
        )
      }
    )
  })

  it('Subscribe, suspend and subscribe', function(done) {
    const subject = 'orderCreated3'
    hemera.act(
      {
        topic,
        cmd: 'subscribe',
        subject
      },
      function(err, resp) {
        expect(err).to.be.not.exists()
        expect(resp.opts).to.be.exists()
        expect(resp.subject).to.be.equals(subject)
        expect(resp.subId).to.be.exists()

        hemera.act(
          {
            topic: `${topic}.clients.${clientId}`,
            cmd: 'suspend',
            subject
          },
          function(err, resp) {
            expect(err).to.be.not.exists()
            expect(resp).to.be.equals(true)

            hemera.act(
              {
                topic,
                cmd: 'subscribe',
                subject
              },
              function(err, resp) {
                expect(err).to.be.not.exists()
                expect(resp.opts).to.be.exists()
                expect(resp.subject).to.be.equals(subject)
                expect(resp.subId).to.be.exists()
                done()
              }
            )
          }
        )
      }
    )
  })

  it('Publish and subscribe', function(done) {
    const subject = 'newNews'
    hemera.act(
      {
        topic,
        cmd: 'subscribe',
        subject
      },
      function(err, resp) {
        expect(err).to.be.not.exists()

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

        hemera.act(
          {
            topic,
            cmd: 'publish',
            subject,
            data: { foo: 'bar' }
          },
          (err, resp) => {
            expect(err).to.be.not.exists()
            expect(resp).to.be.exists()
          }
        )
      }
    )
  })

  it('List active subscribtions', function(done) {
    const subject = 'orderCreated2'
    hemera.act(
      {
        topic,
        cmd: 'subscribe',
        subject
      },
      function(err, resp) {
        expect(err).to.be.not.exists()
        expect(resp.opts).to.be.exists()
        expect(resp.subject).to.be.equals(subject)
        expect(resp.subId).to.be.exists()
        // after subscription two server actions are added suspend and unsubscribe
        expect(hemera.topics.has(`${topic}.clients.${clientId}`)).to.be.equals(
          true
        )

        hemera.act(
          {
            topic: `${topic}.clients.${clientId}`,
            cmd: 'list'
          },
          function(err, resp) {
            expect(err).to.be.not.exists()
            expect(resp).to.be.an.array()
            expect(resp[0].subject).to.be.string()
            expect(resp[0].manualAcks).to.be.boolean()
            done()
          }
        )
      }
    )
  })

  it('Should expose errors', function(done) {
    const subject = 'newNews'
    expect(hemera.natss.ParseError).to.be.exists()
    done()
  })
})
