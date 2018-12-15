# Hemera-nats-streaming package

[![Build Status](https://travis-ci.org/hemerajs/hemera-nats-streaming.svg?branch=master)](https://travis-ci.org/hemerajs/hemera-nats-streaming)
[![npm](https://img.shields.io/npm/v/hemera-nats-streaming.svg?maxAge=3600)](https://www.npmjs.com/package/hemera-nats-streaming)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](#badge)

This is a plugin to use [NATS-Streaming](http://nats.io/) with Hemera.
We use the official [Node-nats-streaming](https://github.com/nats-io/node-nats-streaming) client.
Since nats-streaming based on NATS Server you are able to run both technologies with one NATS-streaming-server.

1.  [Download](http://nats.io/download/nats-io/nats-streaming-server/) and start nats-streaming-server
2.  Start hemera and use this plugin to initialize a connection to the streaming server
3.  You can now use hemera and nats-streaming with one server!

## Install

```
npm i hemera-nats-streaming --save
```

## Usage

```js
const hemera = new Hemera(nats, {
  logLevel: 'debug'
})
hemera.use(hemeraNatsStreaming, {
  clusterId: 'test-cluster',
  clientId: 'test-client',
  options: {} // NATS/STAN options
})
```

## Subscribe

Create a new NATS-Streaming subscription on the given subject. Under the hood all messages are forwarded to the hemera subscriber with request-reply semantics. If you create a subscription on subject `news` you will receive all messages on topic `natss.news` in hemera.

```js
  hemera.natss.add({
    subject: 'news'
    queue: 'news.workers', // (optional) nats-streaming queue group
    options: {}, // (optional) nats-streaming transport options
    pattern: {} // (optional) the pattern which arrive hemera
})
```

Returns the [subscription](https://github.com/nats-io/node-nats-streaming/blob/7e66cf4c047742b82280a7ccb60295f449ed3b7a/lib/stan.js#L574) object of nats-streaming client.

### Available options:

- startWithLastReceived `(boolean)` Subscribe starting with the most recently published value
- deliverAllAvailable `(boolean)` Receive all stored values in order
- startAtSequence: `(integer)` Receive all messages starting at a specific sequence number
- startTime: `(Date)` Subscribe starting at a specific time
- startAtTimeDelta `(integer)`
- durableName `(string)` Create a durable subscription
- maxInFlight `(integer)` The maximum number of outstanding acknowledgements
- manualAckMode: (`boolean`, default: `true`)
- ackWait (`integer`, default: `30000` ms) If an acknowledgement is not received within the configured timeout interval, NATS Streaming will attempt redelivery of the message.

## Publish in hemera

Publish a message to NATS-Streaming server.

```js
hemera.act({
  topic: 'natss',
  cmd: 'publish',
  subject: 'news',
  data: { foo: 'bar' }
})
```

## Subscribe in hemera

Create a NATS subscription to listen on NATS-Streaming events.

```js
hemera.add(
  {
    topic: 'natss.news'
  },
  async () => {
    //... throw or resolve to represent the operation state
  }
)
```

## Plugin decorators

- hemera.natss.add
- hemera.natss.ParseError

## FAQ

- [`Why you don't implement nats-streaming in hemera?`](#why-you-dont-implement-nats-streaming-in-hemera)
- [`Why we need NATS-Streaming?`](#why-we-need-nats-streaming)
- [`What's the difference when I use NATS-Streaming directly?`](#whats-the-difference-when-I-use-nats-streaming-directly)

### Why you don't implement nats-streaming in hemera?

They use the same server but the purpose is quite different with hemera we want to provide a simple toolkit without any delivery guarantee. NATS-streaming was created to fill this gap with a mimimalistic protocol extension. We can use this feature while creating a simple bridge to nats-streaming. It will create a minimal roundtrip overhead but it's tolerable. The greatest fact is that we can run both technologies side by side with one nats-streaming-server.

### Why we need NATS-Streaming?

Usually we would use a queue like RabbitMQ to ensure reliable message delivery but maintaining RabbitMQ as well as writing or finding a reliable driver is hard. The authors of NATS-Streaming and NATS know this and that's the reason why they made it as easy as possible.

### What's the difference when I use NATS-Streaming directly?

That's good question. In NATS-Streaming there aren't request/reply semantic. If you publish something it doesn't mean that the requestor has received it but it will guarantee that the messages are persistent and replayed in the way you defined it.

## Caveats

- The Hemera proxy subscription can only encode/decode JSON at the moment.
- Messages from NATS-Streaming are forwarded to a Hemera subscriber. We can only support (request / reply), (queue-group) semantic (no fanout) to ensure message acknowledgement.
