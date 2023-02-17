import { Buffer } from 'buffer';
import { Duplex } from 'stream';
import {
  CommunicationLayerMessage,
  ConnectionStatus,
  EventType,
  RemoteCommunication,
} from '@metamask/sdk-communication-layer';
import { METHODS_TO_REDIRECT } from '../config';
import { ProviderConstants } from '../constants';
import { Platform } from '../Platform/Platfform';
import { Ethereum } from '../services/Ethereum';
import { PlatformType } from '../types/PlatformType';
import { PostMessageStream } from './PostMessageStream';

export class RemoteCommunicationPostMessageStream
  extends Duplex
  implements PostMessageStream
{
  private _name: any;

  private remote: RemoteCommunication;

  private debug;

  constructor({
    name,
    remote,
    debug,
  }: {
    name: ProviderConstants;
    remote: RemoteCommunication;
    debug: boolean;
  }) {
    super({
      objectMode: true,
    });
    this._name = name;
    this.remote = remote;
    this.debug = debug;

    this._onMessage = this._onMessage.bind(this);
    this.remote.on(EventType.MESSAGE, this._onMessage);

    this.remote.on(EventType.CLIENTS_READY, async () => {
      try {
        const provider = Ethereum.getProvider();
        await provider.forceInitializeState();

        if (debug) {
          console.debug(
            `RCPMS::on 'clients_ready' provider.state`,
            provider.getState(),
          );
        }
      } catch (err) {
        // Ignore error if already initialized.
        // console.debug(`IGNORE ERROR`, err);
      }
    });

    this.remote.on(
      EventType.CONNECTION_STATUS,
      (connectionStatus: ConnectionStatus) => {
        if (connectionStatus === ConnectionStatus.TERMINATED) {
          const provider = Ethereum.getProvider();
          provider.handleDisconnect({ terminate: true });
        } else if (connectionStatus === ConnectionStatus.DISCONNECTED) {
          const provider = Ethereum.getProvider();
          provider.handleDisconnect({ terminate: false });
        }
      },
    );

    // this.remote.on(EventType.CLIENTS_DISCONNECTED, () => {
    //   if (this.debug) {
    //     console.debug(`[RCPMS] received '${EventType.CLIENTS_DISCONNECTED}'`);
    //   }

    //   const provider = Ethereum.getProvider();
    //   provider.handleDisconnect({ terminate: false });
    // });
  }

  /**
   * Called when querying the sdk provider with ethereum.request
   */
  _write(
    chunk: any,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const platform = Platform.getInstance();
    const isReactNative = platform.isReactNative();
    // Special Case if RN, we still create deeplink to wake up the connection.
    const isRemoteReady = this.remote.isReady();
    const isConnected = this.remote.isConnected();
    const isPaused = this.remote.isPaused();
    const provider = Ethereum.getProvider();

    // FIXME invalid state -- isReady is false after terminate.
    console.debug(
      `RPCMS::_write isRemoteReady=${isRemoteReady} isRemoteConnected=${isConnected} isRemotePaused=${isPaused} providerConnected=${provider.isConnected()}`,
    );

    if (!this.remote.isReady() && !isReactNative) {
      if (this.debug) {
        console.log(`[RCPMS] NOT CONNECTED - EXIT`, chunk);
      }

      return callback();
    }

    const socketConnected = this.remote.isConnected();
    const ready = this.remote.isReady();
    if (this.debug) {
      console.debug(
        `RPCMS::_write remote.isPaused()=${this.remote.isPaused()} ready=${ready} socketConnected=${socketConnected}`,
        chunk,
      );
    }

    try {
      let data;
      if (Buffer.isBuffer(chunk)) {
        data = chunk.toJSON();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        data._isBuffer = true;
      } else {
        data = chunk;
      }

      this.remote.sendMessage(data?.data);

      const isDesktop = platform.getPlatformType() === PlatformType.DesktopWeb;
      const isNotBrowser = platform.isNotBrowser();

      if (!isReactNative && (isDesktop || isNotBrowser)) {
        // Redirect early if nodejs or browser...
        if (this.debug) {
          console.log(
            `RCPMS::_write isDektop=${isDesktop} isNotBrowser=${isNotBrowser}`,
          );
        }
        return callback();
      }

      const targetMethod = data?.data
        ?.method as keyof typeof METHODS_TO_REDIRECT;
      // Check if should open app
      const pubKey = this.remote.getKeyInfo()?.ecies.public ?? '';
      const channelId = this.remote.getChannelId();

      console.debug(`AAAAAAAAAAAAAAAA channelId=${channelId}`);

      const urlParams = encodeURI(
        `channelId=${channelId}&pubkey=${pubKey}&comm=socket`,
      );

      if (METHODS_TO_REDIRECT[targetMethod] && !isDesktop) {
        if (this.debug) {
          console.debug(
            `RCPMS::_write redirect link for '${targetMethod}'`,
            `otp?${urlParams}`,
          );
        }

        // Use otp to re-enable host approval
        platform.openDeeplink(
          `https://metamask.app.link/otp?${urlParams}`,
          `metamask://otp?${urlParams}`,
          '_self',
        );
      } else if (this.remote.isPaused() && !isDesktop) {
        if (this.debug) {
          console.debug(
            `RCPMS::_write MM is PAUSED! deeplink with connect! targetMethod=${targetMethod}`,
          );
        }

        platform.openDeeplink(
          `https://metamask.app.link/connect?redirect=true&${urlParams}`,
          `metamask://connect?redirect=true&${urlParams}`,
          '_self',
        );
      } else {
        // Already connected with custom rpc method (don't need redirect) - send message without opening metamask mobile.
        // This only happens when metamask was opened in last 30seconds.
      }
    } catch (err) {
      if (this.debug) {
        console.error('RCPMS::_write error', err);
      }
      return callback(
        new Error('RemoteCommunicationPostMessageStream - disconnected'),
      );
    }

    return callback();
  }

  _read() {
    return undefined;
  }

  _onMessage(message: CommunicationLayerMessage) {
    try {
      // validate message
      /* if (this._origin !== '*' && event.origin !== this._origin) {
      return;
    }*/
      if (this.debug) {
        console.debug(`[RCPMS] _onMessage `, message);
      }

      const typeOfMsg = typeof message;

      if (!message || typeOfMsg !== 'object') {
        return;
      }

      // We only want reply from MetaMask.
      const typeOfData = typeof message?.data;
      if (typeOfData !== 'object') {
        return;
      }

      if (!message?.name) {
        return;
      }

      if (message?.name !== ProviderConstants.PROVIDER) {
        return;
      }

      if (Buffer.isBuffer(message)) {
        const data = Buffer.from(message);
        this.push(data);
      } else {
        this.push(message);
      }
    } catch (err) {
      if (this.debug) {
        console.debug(`RCPMS ignore message error`, err);
      }
    }
  }

  start() {
    // Ethereum.ethereum.isConnected = () => RemoteConnection.isConnected();
  }
}
