import * as O from 'fp-ts/lib/Option';
import { pipe } from 'fp-ts/lib/pipeable';
import {
  Event,
  HttpServerEventStreamToken,
  matchEvent,
  ServerEvent,
  AllServerEvents,
  useContext,
  LoggerToken,
  LoggerTag,
  LoggerLevel,
  isEventError,
  EventError,
  createReader,
} from '@marblejs/core';
import { isNamedError, NamedError } from '@marblejs/core/dist/+internal/utils';
import { from, Observable, EMPTY, throwError, of, defer } from 'rxjs';
import { mergeMap, take, map, timeout } from 'rxjs/operators';
import { TransportMessage, DEFAULT_TIMEOUT } from '../transport/transport.interface';
import { provideTransportLayer } from '../transport/transport.provider';
import { jsonTransformer } from '../transport/transport.transformer';
import { MessagingClient, MessagingClientConfig } from './messaging.client.interface';

export const messagingClient = (config: MessagingClientConfig) => {
  const {
    transport,
    options,
    msgTransformer = jsonTransformer,
  } = config;

  return createReader<Promise<MessagingClient>>(async ask => {
    const logger = useContext(LoggerToken)(ask);
    const transportLayer = provideTransportLayer(transport, options);
    const connection = await transportLayer.connect({ isConsumer: false });

    const emit = async <I extends Event>(event: I): Promise<void> => {
      await connection.emitMessage(
        connection.getChannel(),
        { data: msgTransformer.encode(event) },
      );
    }

    const send = <O extends Event, I extends Event>(event: I): Observable<O> => {
      const channel = connection.getChannel();
      const message: TransportMessage<Buffer> = { data: msgTransformer.encode(event) };

      const catchErrorEvent = <V extends Event>(e: V) => {
        if (!e.error) {
          return of(e);
        }

        if (isEventError(e.error)) {
          return throwError(new EventError(e, e.error.message, e.error.data));
        }

        if (isNamedError(e.error)) {
          return throwError(new NamedError(e.error.name, e.error.message));
        }

        const parsedError = JSON.stringify(e.error);

        logger({
          tag: LoggerTag.MESSAGING,
          type: 'messagingClient',
          message: `Caught an error with invalid structure: ${parsedError}`,
          level: LoggerLevel.WARN,
        })();

        return throwError(new Error(parsedError));
      }

      return defer(() => from(connection.sendMessage(channel, message)).pipe(
        timeout(config.options.timeout || DEFAULT_TIMEOUT),
        map(m => msgTransformer.decode<O>(m.data)),
        mergeMap(catchErrorEvent),
        take(1),
      ));
    }

    const close = async (): Promise<void> => {
      await connection.close();
    }

    const teardownOnClose = (event$: Observable<AllServerEvents>) =>
      event$.pipe(
        matchEvent(ServerEvent.close),
        take(1),
        mergeMap(() => connection.close()),
      );

    pipe(
      ask(HttpServerEventStreamToken),
      O.map(teardownOnClose),
      O.getOrElse(() => EMPTY as Observable<any>),
    ).subscribe();

    return {
      emit,
      send,
      close,
    };
  });
};
