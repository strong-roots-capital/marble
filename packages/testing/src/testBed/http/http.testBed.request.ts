import { HttpMethod, HttpHeaders } from '@marblejs/core'
import * as O from 'fp-ts/lib/Option';
import * as A from 'fp-ts/lib/Array';
import { pipe } from 'fp-ts/lib/pipeable';
import { getMimeType } from '@marblejs/core/dist/http/response/http.responseContentType.factory';
import { HttpTestBedRequest, WithBodyApplied } from './http.testBed.request.interface';
import { createTestingRequestHeader } from './http.testBed.util';

export const createRequest = (port: number, host: string, headers?: HttpHeaders) =>
  <T extends HttpMethod>(method: T): HttpTestBedRequest<T> => ({
    protocol: 'http:',
    path: '/',
    headers: {
      ...createTestingRequestHeader(),
      ...headers,
    },
    method,
    host,
    port,
  });

export const withPath = (path: string) => <T extends HttpMethod>(req: HttpTestBedRequest<T>): HttpTestBedRequest<T> => ({
  ...req,
  path,
});

export const withHeaders = (headers: HttpHeaders) => <T extends HttpMethod>(req: HttpTestBedRequest<T>): HttpTestBedRequest<T> => ({
  ...req,
  headers: { ...req.headers, ...headers },
});

export const withBody = <T>(body: T) => <U extends 'POST' | 'PUT' | 'PATCH'>(req: HttpTestBedRequest<U>): HttpTestBedRequest<U> & WithBodyApplied<T> =>
  pipe(
    getHeader('Content-Type')(req),
    O.map(() => ({ ...req, body })),
    O.getOrElse(() => pipe(
      getMimeType(body, req.path),
      type => withHeaders({ 'Content-Type': type })(req),
      req => ({ ...req, body }),
    ))
  );

export const getHeader = <T extends string = string>(key: string) => (req: HttpTestBedRequest<any>): O.Option<T> =>
  pipe(
    O.fromNullable(req.headers[key]),
    O.chain(header => Array.isArray(header)
      ? A.head(header) as O.Option<T>
      : O.some(header) as O.Option<T>),
  );
