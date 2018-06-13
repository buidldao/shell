// Copyright 2015-2017 Parity Technologies (UK) Ltd.
// This file is part of Parity.

// Parity is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Parity is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Parity.  If not, see <http://www.gnu.org/licenses/>.

import Api from '@parity/api';
import qs from 'query-string';

function getAppId () {
  // Local dapps: file:///home/username/.config/Parity-UI/dapps/mydapp/index.html?appId=LOCAL-dapp-name
  // Local dapps served in development mode on a dedicated port: http://localhost:3001/?appId=LOCAL-dapp-name
  const fromQuery = qs.parse(window.location.search).appId;

  if (fromQuery) { return fromQuery; }

  // Built-in dapps: file://path-to-shell/.build/dapps/0x0587.../index.html
  // Built-in dapps when running Electron in dev mode: http://127.0.0.1:3000/dapps/v1/index.html
  const [, id] = window.location.pathname.match(/dapps\/([^/]+)\//) || [];

  if (id) { return id; }

  // Dapps installed from the registry and served by Parity: http://127.0.0.1:8545/ff19...
  const [hash] = window.location.pathname.match(/(0x)?[a-f0-9]{64}/i) || [];

  if (hash) { return hash; }

  console.error('Could not find appId');
}

function initProvider () {
  const appId = getAppId();

  // The dapp will use the PostMessage provider, send postMessages to
  // preload.js, and preload.js will relay those messages to the shell.
  const ethereum = new Api.Provider.PostMessage(appId);

  console.log(`Requesting API communications token for ${appId}`);

  ethereum
    .requestNewToken()
    .then((tokenId) => {
      console.log(`Received API communications token ${tokenId}`);
    })
    .catch((error) => {
      console.error('Unable to retrieve communications token', error);
    });

  window.ethereum = ethereum;
  window.isParity = true;

  return ethereum;
}

function initWeb3 (ethereum) {
  const currentProvider = new Api.Provider.SendAsync(ethereum);

  window.web3 = { currentProvider };
}

function initParity (ethereum) {
  const api = new Api(ethereum);

  window.parity = Object.assign({}, window.parity || {}, {
    Api,
    api
  });
}

if (typeof window !== 'undefined' && !window.isParity) {
  const ethereum = initProvider();

  initWeb3(ethereum);
  initParity(ethereum);

  console.warn('Deprecation: Dapps should only used the exposed EthereumProvider on `window.ethereum`, the use of `window.parity` and `window.web3` will be removed in future versions of this injector');

  // Disable eval() for dapps
  // https://electronjs.org/docs/tutorial/security#7-override-and-disable-eval
  //
  // TODO Currently Web3 Console dapp needs eval(), and is the only builtin
  // that needs it, so we cannot blindly disable it as per the recommendation.
  // One idea is to check here in inject.js if allowJsEval is set to true, but
  // this requires more work (future PR).
  // For now we simply allow eval(). All builtin dapps are trusted and can use
  // eval(), and all network dapps are served on 127.0.0.1:8545, which have CSP
  // that disallow eval(). So security-wise it should be enough.
  //
  // window.eval = global.eval = function () { // eslint-disable-line
  //   throw new Error(`Sorry, this app does not support window.eval().`);
  // };
}
