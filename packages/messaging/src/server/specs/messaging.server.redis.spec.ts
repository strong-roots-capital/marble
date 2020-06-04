import { matchEvent, use } from '@marblejs/core';
import { createUuid } from '@marblejs/core/dist/+internal/utils';
import { eventValidator$, t } from '@marblejs/middleware-io';
import { forkJoin, TimeoutError } from 'rxjs';
import { map, tap, delay, mapTo } from 'rxjs/operators';
import { TransportLayerConnection } from '../../transport/transport.interface';
import { MsgEffect } from '../../effects/messaging.effects.interface';
import { MessagingClient } from '../../client/messaging.client.interface';
import { reply } from '../../effects/messaging.effects.helper';
import * as Util from '../../util/messaging.test.util';

describe('messagingServer::Redis', () => {
  let client: MessagingClient;
  let microservice: TransportLayerConnection;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => jest.fn());
  });

  afterEach(async () => {
    if (microservice) await microservice.close();
    if (client) await client.close();
  });

  test('starts a server and closes connection immediately', async () => {
    const options = Util.createRedisOptions();

    const microservice = await Util.createRedisMicroservice(options)({});
    const client = await Util.createRedisClient(options);

    await microservice.close();
    await client.close();
  });

  test('handles RPC communication', async () => {
    // given
    const options = Util.createRedisOptions();

    const increment$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('INCREMENT'),
        use(eventValidator$(t.number)),
        delay(50),
        map(event => ({ ...event, type: 'INCREMENT_RESULT', payload: event.payload + 1 })),
      );

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [increment$] });
    client = await Util.createRedisClient(options);

    const result = await forkJoin([
      client.send({ type: 'INCREMENT', payload: 1 }),
      client.send({ type: 'INCREMENT', payload: 10 }),
    ]).toPromise();

    // then
    expect(result[0]).toEqual({ type: 'INCREMENT_RESULT', payload: 2 });
    expect(result[1]).toEqual({ type: 'INCREMENT_RESULT', payload: 11 });
  });

  test('handles RPC communication when error event is returned', async () => {
    // given
    const options = Util.createRedisOptions();
    const error = new Error('test_error');

    const test$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('TEST'),
        map(event => reply(event)({ type: 'TEST_RESULT', error })),
      );

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [test$] });
    client = await Util.createRedisClient(options);

    const result = client.send({ type: 'TEST' }).toPromise();

    // then
    await expect(result).rejects.toEqual(error);
  });

  test('handles RPC communication when event is timeouted (eg. no event handler is defined)', async () => {
    // given
    const options = Util.createRedisOptions();

    // when
    microservice = await Util.createRedisMicroservice(options)();
    client = await Util.createRedisClient(options);

    const result = client.send({ type: 'TEST' }).toPromise();

    // then
    await expect(result).rejects.toEqual(new TimeoutError());
  });

  test('handles non-blocking communication and routes the event back to origin channel', async done => {
    // given
    const options = Util.createRedisOptions();

    const increment$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('INCREMENT'),
        use(eventValidator$(t.number)),
        delay(50),
        map(event => ({ ...event, type: 'INCREMENT_RESULT', payload: event.payload + 1 })),
      );

    // then
    const output$ = Util.assertOutputEvent({
      type: 'INCREMENT_RESULT',
      payload: 2,
      metadata: expect.objectContaining({ replyTo: options.channel, correlationId: expect.any(String) }),
    })(done);

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [increment$], output$ });
    client = await Util.createRedisClient(options);

    await client.emit({ type: 'INCREMENT', payload: 1 });
  });

  test('throws an "UnsupportedError" when calling "ackMessage/nackMessage"', async done => {
    // given
    const options = Util.createRedisOptions();

    const test$: MsgEffect = (event$, ctx) =>
      event$.pipe(
        matchEvent('TEST'),
        tap(event => ctx.client.ackMessage(event.metadata?.raw)),
      );

    const error$ = Util.assertError({
      name: 'UnsupportedError',
      message: 'Unsupported operation. Method \"ackMessage\" is unsupported for Redis transport layer.',
    })(done);

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [test$], error$ });
    client = await Util.createRedisClient(options);

    await client.emit({ type: 'TEST' });
  });

  test('chains events by sending back to origin channel when no reply is defined', async done => {
    // given
    const options = Util.createRedisOptions();

    const test1$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('TEST_1'),
        delay(25),
        mapTo({ type: 'TEST_2' }),
      );

    const test2$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('TEST_2'),
        delay(25),
        mapTo({ type: 'TEST_3' }),
      );

    // then
    const output$ = Util.assertOutputEvent(
      { type: 'TEST_2' },
      { type: 'TEST_3' },
    )(done);

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [test1$, test2$], output$ });
    client = await Util.createRedisClient(options);

    await client.emit({ type: 'TEST_1' });
  });

  test('sends outgoing event to different channel and doesn\'t cause infinite loop', async done => {
    // given
    const options = Util.createRedisOptions();
    const replyTo = createUuid();

    const test$: MsgEffect = event$ =>
      event$.pipe(
        matchEvent('TEST'),
        map(reply(replyTo)),
      );

    // then
    const output$ = Util.assertOutputEvent({
      type: 'TEST',
      metadata: expect.objectContaining({ replyTo }),
    })(done);

    // when
    microservice = await Util.createRedisMicroservice(options)({ effects: [test$], output$ });
    client = await Util.createRedisClient(options);

    await client.emit({ type: 'TEST' });
  });
});
