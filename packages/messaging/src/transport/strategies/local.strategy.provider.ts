import * as O from 'fp-ts/lib/Option';
import { pipe } from 'fp-ts/lib/pipeable';
import { TransportLayer, TransportLayerConnection, Transport } from '../transport.interface';
import { createLocalStrategy } from './local.strategy';

export class LocalStrategyProvider implements TransportLayer<Transport.LOCAL> {
  private static instance: LocalStrategyProvider;
  private readonly strategy: TransportLayer<Transport.LOCAL>;
  private readonly strategyConnection: Promise<TransportLayerConnection<Transport.LOCAL>>;

  private constructor() {
    this.strategy = createLocalStrategy({});
    this.strategyConnection = this.strategy.connect();
  }

  static getDefault = () => pipe(
    O.fromNullable(LocalStrategyProvider.instance),
    O.getOrElse(() => LocalStrategyProvider.instance = new LocalStrategyProvider()),
  );

  async connect() {
    return this.strategyConnection;
  }

  get type() {
    return this.strategy.type;
  }

  get config() {
    return this.strategy.config;
  }
}

export const provideLocalStrategy = () => LocalStrategyProvider.getDefault();
