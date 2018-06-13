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

import BigNumber from 'bignumber.js';
import { pick, range, uniq } from 'lodash';

import { bytesToHex } from '@parity/api/lib/util/format';
import { IconCache } from '@parity/ui';
import { getBuildPath, getLocalDappsPath } from './host';
import isElectron from 'is-electron';

import builtinApps from '../Dapps/dappsBuiltin.json';
import Contracts from '@parity/shared/lib/contracts';

import path from 'path';

const util = isElectron() ? window.require('util') : require('util');

require('util.promisify').shim();

const fs = isElectron() ? window.require('fs') : require('fs');
const fsReadFile = util.promisify(fs.readFile);
const fsReaddir = util.promisify(fs.readdir);
const fsStat = util.promisify(fs.stat);

export function subscribeToChanges (api, dappReg, callback) {
  return dappReg
    .getContract()
    .then((dappRegContract) => {
      const dappRegInstance = dappRegContract.instance;

      const signatures = ['MetaChanged', 'OwnerChanged', 'Registered']
        .map((event) => dappRegInstance[event].signature);

      return api.eth
        .newFilter({
          fromBlock: '0',
          toBlock: 'latest',
          address: dappRegInstance.address,
          topics: [signatures]
        })
        .then((filterId) => {
          return api
            .subscribe('eth_blockNumber', () => {
              if (filterId > -1) {
                api.eth
                  .getFilterChanges(filterId)
                  .then((logs) => {
                    return dappRegContract.parseEventLogs(logs);
                  })
                  .then((events) => {
                    if (events.length === 0) {
                      return [];
                    }

                    // Return uniq IDs which changed meta-data
                    const ids = uniq(events.map((event) => bytesToHex(event.params.id.value)));

                    callback(ids);
                  });
              }
            })
            .then((blockSubId) => {
              return {
                block: blockSubId,
                filter: filterId
              };
            });
        });
    });
}

export function fetchBuiltinApps (api) {
  const initialApps = builtinApps.filter(app => app.id);

  const builtinDappsPath = path.join(
    getBuildPath(),
    'dapps'
  );

  return Promise
    .all(initialApps.map(app => {
      const manifestPath = path.join(
        builtinDappsPath,
        app.id,
        'manifest.json'
      );

      return fsReadFile(manifestPath)
        .then(r => {
          try {
            return JSON.parse(r);
          } catch (e) {
            console.error(`Couldn't parse manifest.json for ${app.id}`, e);
            return {};
          }
        })
        .catch(e => {
          // We don't require built-in dapps to have manifest.json files;
          // their manifest information is in dappsBuiltin.json
          return {};
        });
    }))
    .then((manifests) => {
      return initialApps
        .map((app, index) => {
          const iconUrl = manifests[index].iconUrl || 'icon.png';

          app.type = 'builtin';
          app.image = `file://${path.join(
            builtinDappsPath,
            app.id,
            iconUrl
          )}`;

          return app;
        });
    });
}

export function fetchLocalApps (api) {
  const dappsPath = getLocalDappsPath();

  return fsReaddir(dappsPath) // List files
    .then(filenames => // Gather info about files
      Promise.all(filenames.map(filename => {
        const filePath = path.join(dappsPath, filename);

        return fsStat(filePath).then(stat => ({ isDirectory: stat.isDirectory(), filePath, filename }));
      }))
    )
    .then(files => // Only keep directories
      files.filter(({ isDirectory }) => isDirectory))
    .then(dappsFolders => // Parse manifests
      Promise.all(dappsFolders.map(({ filePath, filename }) => {
        const manifestPath = path.join(filePath, 'manifest.json');

        return fsReadFile(manifestPath).then(r => {
          try {
            return { filename, manifest: JSON.parse(r) };
          } catch (e) {
            console.error(`Couldn't parse manifest.json for local dapp ${filePath}`, e);
            return { filename };
          }
        }).catch(e => {
          console.error(`Couldn't read manifest.json for ${filePath}`);
          return { filename };
        });
      })))
    .then(dapps =>
      dapps.filter(({ manifest }) => manifest))
    .then(dapps =>
      dapps.map(({ filename, manifest: { id, localUrl, iconUrl, ...rest } }) => (
        {
          ...rest,
          type: 'local',
          // Prevent using the appId of an existing non-local dapp with already approved permissions
          id: `LOCAL-${id}`,
          folderName: 'XYZ',
          visible: true,
          localUrl: localUrl || `file://${dappsPath}/${filename}/index.html`,
          image: `file://${dappsPath}/${filename}/${iconUrl}`
        }
    )))
    .catch((error) => {
      console.warn('DappsStore:fetchLocal', error);
    });
}

export function fetchRegistryAppIds (api) {
  const { dappReg } = Contracts.get(api);

  return dappReg
    .count()
    .then((count) => {
      const promises = range(0, count.toNumber()).map((index) => dappReg.at(index));

      return Promise.all(promises);
    })
    .then((appsInfo) => {
      const appIds = appsInfo
        .map(([appId, owner]) => bytesToHex(appId))
        .filter((appId) => {
          return (new BigNumber(appId)).gt(0) && !builtinApps.find((app) => app.id === appId);
        });

      return uniq(appIds);
    })
    .catch((error) => {
      console.warn('DappsStore:fetchRegistryAppIds', error);
    });
}

export function fetchRegistryApp (api, dappReg, appId) {
  return Promise
    .all([
      dappReg.getImage(appId),
      dappReg.getContent(appId),
      dappReg.getManifest(appId)
    ])
    .then(([imageId, contentId, manifestId]) => {
      const app = {
        id: appId,
        image: IconCache.hashToImage(imageId),
        contentHash: bytesToHex(contentId).substr(2),
        manifestHash: bytesToHex(manifestId).substr(2),
        type: 'network',
        visible: true
      };

      return fetchManifest(api, app.manifestHash)
        .then((manifest) => {
          if (manifest) {
            app.manifestHash = null;

            // Add usefull manifest fields to app
            Object.assign(app, pick(manifest, ['author', 'description', 'name', 'version']));
          }

          return app;
        });
    })
    .then((app) => {
      // Keep dapps that has a Manifest File and an Id
      const dapp = (app.manifestHash || !app.id) ? null : app;

      return dapp;
    })
    .catch((error) => {
      console.warn('DappsStore:fetchRegistryApp', error);
    });
}

export function fetchManifest (api, manifestHash) {
  if (/^(0x)?0+/.test(manifestHash)) {
    return Promise.resolve(null);
  }

  return api.parity
    .dappsUrl()
    .then(dappsUrl => {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

      return fetch(
        `${protocol}//${dappsUrl}/api/content/${manifestHash}/`,
        { redirect: 'follow', mode: 'cors' }
      );
    })
    .then((response) => {
      return response.ok
        ? response.json()
        : null;
    })
    .then((manifest) => {
      return manifest;
    })
    .catch((error) => {
      console.warn('DappsStore:fetchManifest', error);
      return null;
    });
}
