import { Duplex } from 'stream';
import { BaseProvider, MetaMaskInpageProvider } from '@metamask/providers';

export interface SDKProviderProps {
  /**
   * The stream used to connect to the wallet.
   */
  connectionStream: Duplex;

  /**
   * Automatically call eth_requestAccounts on initialization.
   */
  autoRequestAccounts?: boolean;

  /**
   * Whether the provider should be set as window.ethereum.
   */
  shouldSetOnWindow?: boolean;
  shouldSendMetadata?: boolean;
  /**
   * Whether the window.web3 shim should be set.
   */
  shouldShimWeb3?: boolean;
  debug?: boolean;
}

export class SDKProvider extends MetaMaskInpageProvider {
  private debug = false;

  private autoRequestAccounts = false;

  constructor({
    connectionStream,
    shouldSendMetadata,
    debug = false,
    autoRequestAccounts = false,
  }: SDKProviderProps) {
    super(connectionStream, {
      logger: console,
      maxEventListeners: 100,
      shouldSendMetadata,
    });
    this.autoRequestAccounts = autoRequestAccounts;
    this.debug = debug;
  }

  async forceInitializeState() {
    if (this.debug) {
      console.debug(
        `SDKProvider::forceInitializeState() autoRequestAccounts=${this.autoRequestAccounts}`,
      );
    }
    this._initializeStateAsync();
  }

  getState() {
    return this._state;
  }

  handleDisconnect({ terminate = false }: { terminate: boolean }) {
    if (this.debug) {
      console.debug(
        `SDKProvider::handleDisconnect() cleaning up provider state`,
      );
    }

    if (terminate) {
      // this.chainId = null;
      // this._state.accounts = null;
      // this.selectedAddress = null;
      // this._state.isUnlocked = false;
      // this._state.isPermanentlyDisconnected = true;
      // this._state.initialized = false;
      this._state.isConnected = false;
    } else {
      this._state.isConnected = false;
    }
  }

  protected async _initializeStateAsync(): Promise<void> {
    if (this.debug) {
      console.debug(`SDKProvider::_initializeStateAsync()`);
    }
    // Replace super.initialState logic to automatically request account if not found in providerstate.
    let initialState: Parameters<BaseProvider['_initializeState']>[0];
    try {
      initialState = (await this.request({
        method: 'metamask_getProviderState',
      })) as Parameters<BaseProvider['_initializeState']>[0];
    } catch (error) {
      this._log.error(
        'MetaMask: Failed to get initial state. Please report this bug.',
        error,
      );
    }

    // console.debug(`SDKProvider::_initializeStateAsync state `, initialState);
    // if (
    //   Platform.getInstance().isBrowser() &&
    //   initialState?.accounts?.length === 0
    // ) {
    //   console.debug(`SDKProvider::_initializeStateAsync fetch accounts`);
    //   const accounts = (await this.request({
    //     method: 'eth_requestAccounts',
    //     params: [],
    //   })) as string[];
    //   initialState.accounts = accounts;
    // }
    this._initializeState(initialState);
  }

  protected _initializeState(
    initialState?:
      | {
          accounts: string[];
          chainId: string;
          isUnlocked: boolean;
          networkVersion?: string | undefined;
        }
      | undefined,
  ): void {
    if (this.debug) {
      console.debug(
        `SDKProvider::_initializeState() set state._initialized to false`,
      );
    }
    // Force re-initialize without error.
    this._state.initialized = false;
    return super._initializeState(initialState);
  }

  protected _handleChainChanged({
    chainId,
    networkVersion,
  }: { chainId?: string; networkVersion?: string } = {}) {
    if (this.debug) {
      console.debug(
        `SDKProvider::_handleChainChanged chainId=${chainId} networkVersion=${networkVersion}`,
      );
    }

    // FIXME on RN IOS networkVersion is sometime missing? why?
    let forcedNetworkVersion = networkVersion;
    if (!networkVersion) {
      console.info(`forced network version to prevent provider error`);
      forcedNetworkVersion = '1';
    }

    super._handleChainChanged({
      chainId,
      networkVersion: forcedNetworkVersion,
    });
  }
}
