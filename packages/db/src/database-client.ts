import { Client, type ClientConfig } from 'pg';
import { markConnectionError } from './classify-database-error.ts';

// The pg client every pool `createDatabase` builds and `prepareDatabase` connect with. pg 8.23.1
// sends every socket error through its `Connection`'s `error` event (`lib/connection.js`
// `reportStreamError`) before it rejects the connect or the query, so marking each one there is
// what lets the classifier tell a database socket from any other client's (D9).
// `connect()` hands back the raw Node error with no pg wrapper, so the mark is the only sign of
// where it came from.
export class DatabaseClient extends Client {
  constructor(config?: string | ClientConfig) {
    super(config);
    this.connection.on('error', markConnectionError);
  }
}
