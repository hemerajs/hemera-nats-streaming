# Hemera-nats-streaming package

[![Build Status](https://travis-ci.org/hemerajs/hemera-nats-streaming.svg?branch=master)](https://travis-ci.org/hemerajs/hemera-nats-streaming)
[![npm](https://img.shields.io/npm/v/hemera-nats-streaming.svg?maxAge=3600)](https://www.npmjs.com/package/hemera-nats-streaming)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](#badge)

This is a plugin to use [NATS-Streaming](http://nats.io/) with Hemera.
We use the official [Node-nats-streaming](https://github.com/nats-io/node-nats-streaming) client.
Since nats-streaming based on NATS Server you are able to run both technologies with one NATS-streaming-server.

* [Download](http://nats.io/download/nats-io/nats-streaming-server/) and start nats-streaming-server
* Start hemera and use this plugin to initialize a connection to the streaming server
* You can now use hemera and nats-streaming with one server!

## Install

```
npm i hemera-joi hemera-nats-streaming --save
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

We provide a simple interface to work with nats-streaming

## Subscribe

Create a new NATS-Streaming subscription on the given subject. Under the hood all messages are forwarded to the hemera subscriber with request-reply semantics. If you create a subscription on subject `test` you will receive all messages on topic `natss.test` in hemera. Returns an object like:

```js
{
  "subject": "news",
  "opts": { /*applied options*/ },
  "subId": 5
}
```

```js
hemera.act({
  topic: 'natss',
  cmd: 'subscribe',
  subject: 'news'
})
```

## Unsubscribe

Removes the subscription from NATS-Streaming server. Returns `true` or `false` when subscription could be unsubscribed.

```js
hemera.act({
  topic: 'natss.subscriptions.{subId}',
  cmd: 'suspend'
})
```

## Suspend

Suspend the subscription from NATS-Streaming server. You can active it if you call `subscribe` again. Returns `true` or `false` when subscription could be suspended.

```js
hemera.act({
  topic: 'natss.subscriptions.{subId}',
  cmd: 'unsubscribe'
})
```

## Publish in hemera

Publish a message to NATS-Streaming server.

```js
hemera.act({
  topic: 'nats-streaming',
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

## Why you don't implement nats-streaming in hemera?

They use the same server but the purpose is quite different with hemera we want to provide a simple toolkit without any delivery guarantee. NATS-streaming was created to fill this gap with a mimimalistic protocol extension. We can use this feature while creating a simple bridge to nats-streaming. It will create a minimal roundtrip overhead but it's tolerable. The greatest fact is that we can run both technologies side by side\* with one nats-streaming-server.

## Why we need NATS-Streaming?

Usually we would use RabbitMQ to ensure reliable message delivery but maintaining RabbitMQ as well as writing a reliable driver is hard. With NATS-Streaming we can use the same technology which hemera based on to combine both aspects without to increase the complexity.

## Caveats

* Only JSON support
* NATS Streaming subscriptions do not support wildcards but there is a [proposal](https://github.com/nats-io/nats-streaming-server/issues/340).
* Messages from NATS-Streaming are forwarded to a NATS subscriber. We can only support (request / reply), (queue-group) semantic (no fanout) to ensure message acknowledgement.
