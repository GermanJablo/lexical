/* eslint-disable header/header */

import {LexicalDocNode} from '@lexical/docnode';
import {Doc, type Operations} from 'docnode';

const url = new URL(window.location.href);
const params = new URLSearchParams(url.search);
const WEBSOCKET_ENDPOINT =
  params.get('docnodeEndpoint') || 'ws://localhost:1235';
const WEBSOCKET_SLUG = 'playground';
const WEBSOCKET_ID = params.get('collabId') || '0';

// Store singletons in window to survive HMR (Hot Module Replacement)
declare global {
  interface Window {
    __DOCNODE_DOCS__?: Map<string, Doc>;
    __DOCNODE_PROVIDERS__?: Map<string, DocNodeProvider>;
  }
}

// Initialize global storage if not exists
if (!window.__DOCNODE_DOCS__) {
  window.__DOCNODE_DOCS__ = new Map();
}
if (!window.__DOCNODE_PROVIDERS__) {
  window.__DOCNODE_PROVIDERS__ = new Map();
}

const globalDocNodeDocs = window.__DOCNODE_DOCS__;
const globalDocNodeProviders = window.__DOCNODE_PROVIDERS__;

export interface DocNodeProvider {
  doc: Doc;
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
  isConnected: boolean;
}

export function createDocNodeWebsocketProvider(id: string): DocNodeProvider {
  // Check if provider already exists (singleton per room)
  const existingProvider = globalDocNodeProviders.get(id);
  if (existingProvider) {
    return existingProvider;
  }

  // Get or create Doc (initialized with initial paragraph via fromJSON)
  let doc = globalDocNodeDocs.get(id);

  if (doc === undefined) {
    // Create Doc with initial state (same as all other clients)
    doc = Doc.fromJSON({extensions: [{nodes: [LexicalDocNode]}]}, [
      '01kc52hq510g6y44jhq0wqrjb3',
      'root',
      {},
    ]);
    globalDocNodeDocs.set(id, doc);
  }

  // Create provider and store in global map
  const provider = createDocNodeWebsocketProviderWithDoc(id, doc);
  globalDocNodeProviders.set(id, provider);

  return provider;
}

export function createDocNodeWebsocketProviderWithDoc(
  id: string,
  doc: Doc,
): DocNodeProvider {
  const roomId = `${WEBSOCKET_SLUG}/${WEBSOCKET_ID}/${id}`;
  const clientId = Math.random().toString(36).slice(2); // Unique client ID
  let ws: WebSocket | null = null;
  let isConnected = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track if we're applying remote operations to prevent echo
  let isApplyingRemote = false;

  // Operation queue to prevent nested transactions
  const operationQueue: Operations[] = [];
  let isProcessingQueue = false;

  let unsubscribe: (() => void) | null = null;

  const provider: DocNodeProvider = {
    connect() {
      if (
        ws &&
        (ws.readyState === WebSocket.CONNECTING ||
          ws.readyState === WebSocket.OPEN)
      ) {
        return; // Already connected or connecting
      }

      const wsUrl = `${WEBSOCKET_ENDPOINT}/${roomId}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        isConnected = true;
        provider.isConnected = true;

        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };

      const processOperationQueue = () => {
        if (isProcessingQueue || operationQueue.length === 0) {
          return;
        }

        isProcessingQueue = true;
        const operation = operationQueue.shift();

        if (operation) {
          try {
            isApplyingRemote = true;
            doc.applyOperations(operation);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[DocNode] Error applying operation:', error);
          } finally {
            // Keep isApplyingRemote = true until next tick to ensure onChange handlers see it
            queueMicrotask(() => {
              isApplyingRemote = false;
            });
            isProcessingQueue = false;
            // Process next operation if any
            if (operationQueue.length > 0) {
              queueMicrotask(processOperationQueue);
            }
          }
        } else {
          isProcessingQueue = false;
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            clientId?: string;
            isFirstClient?: boolean;
            operations?: Operations[];
            type: string;
            operation?: Operations;
          };

          if (message.type === 'sync') {
            const hasHistory =
              message.operations && message.operations.length > 0;

            if (hasHistory) {
              for (const operations of message.operations) {
                operationQueue.push(operations);
              }
              queueMicrotask(processOperationQueue);
            }
          } else if (message.type === 'operation' && message.operation) {
            // Skip operations from self
            if (message.clientId === clientId) {
              return;
            }

            // Queue remote operation
            operationQueue.push(message.operation);
            queueMicrotask(processOperationQueue);
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[DocNode] Error processing message:', error);
        }
      };

      ws.onerror = () => {
        // Connection error - will trigger onclose
      };

      ws.onclose = () => {
        isConnected = false;
        provider.isConnected = false;

        // Attempt to reconnect after 1 second
        if (!reconnectTimeout) {
          reconnectTimeout = setTimeout(() => {
            provider.connect();
          }, 1000);
        }
      };

      // Listen for local changes and send to server
      // Only register listener if not already registered
      if (!unsubscribe) {
        unsubscribe = doc.onChange((ev) => {
          if (
            isApplyingRemote ||
            !isConnected ||
            !ws ||
            ws.readyState !== WebSocket.OPEN
          ) {
            return;
          }

          // Send operation to server with clientId
          ws.send(
            JSON.stringify({
              clientId,
              operation: ev.operations,
              type: 'operation',
            }),
          );
        });
      }
    },

    destroy() {
      this.disconnect();
      if (unsubscribe) {
        unsubscribe();
      }
    },

    disconnect() {
      if (ws) {
        ws.close();
        ws = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    },

    doc,
    isConnected: false,
  };

  return provider;
}
