/**
 * Inline JSON proto descriptor for Kaspa / HTND gRPC messages.
 *
 * Based on the official protowire definitions from kaspanet/kaspad
 * (which HTND is a fork of).  Field numbers and types match the
 * canonical .proto files exactly.
 *
 * Only the subset of messages used by DAGPulse is included.
 */

import * as $protobuf from 'protobufjs/light'

const descriptor = {
  nested: {
    protowire: {
      nested: {
        // ──────────────────────── Shared helpers ───────────────────────────
        RPCError: {
          fields: { message: { type: 'string', id: 1 } },
        },

        // ──────────────────────── Block types ──────────────────────────────
        RpcBlockLevelParents: {
          fields: {
            parentHashes: { rule: 'repeated', type: 'string', id: 1 },
          },
        },

        RpcBlockHeader: {
          fields: {
            version:      { type: 'uint32', id: 1  },
            parents:      { rule: 'repeated', type: 'RpcBlockLevelParents', id: 12 },
            timestamp:    { type: 'int64',  id: 6  },
            bits:         { type: 'uint32', id: 7  },
            nonce:        { type: 'uint64', id: 8  },
            daaScore:     { type: 'uint64', id: 9  },
            blueWork:     { type: 'string', id: 10 },
            blueScore:    { type: 'uint64', id: 13 },
            pruningPoint: { type: 'string', id: 14 },
          },
        },

        RpcBlockVerboseData: {
          fields: {
            hash:                { type: 'string', id: 1  },
            selectedParentHash:  { type: 'string', id: 13 },
            isHeaderOnly:        { type: 'bool',   id: 15 },
            blueScore:           { type: 'uint64', id: 16 },
            mergeSetBluesHashes: { rule: 'repeated', type: 'string', id: 18 },
            mergeSetRedsHashes:  { rule: 'repeated', type: 'string', id: 19 },
            isChainBlock:        { type: 'bool',   id: 20 },
          },
        },

        RpcTransactionVerboseData: {
          fields: { transactionId: { type: 'string', id: 1 } },
        },

        RpcTransaction: {
          fields: {
            verboseData: { type: 'RpcTransactionVerboseData', id: 9 },
          },
        },

        RpcBlock: {
          fields: {
            header:       { type: 'RpcBlockHeader',      id: 1 },
            transactions: { rule: 'repeated', type: 'RpcTransaction', id: 2 },
            verboseData:  { type: 'RpcBlockVerboseData', id: 3 },
          },
        },

        // ──────────────────────── GetBlock ─────────────────────────────────
        GetBlockRequestMessage: {
          fields: {
            hash:                { type: 'string', id: 1 },
            includeTransactions: { type: 'bool',   id: 3 },
          },
        },
        GetBlockResponseMessage: {
          fields: {
            block: { type: 'RpcBlock', id: 3    },
            error: { type: 'RPCError', id: 1000 },
          },
        },

        // ──────────────────────── GetBlockDagInfo ──────────────────────────
        GetBlockDagInfoRequestMessage: { fields: {} },
        GetBlockDagInfoResponseMessage: {
          fields: {
            networkName:     { type: 'string', id: 1 },
            blockCount:      { type: 'uint64', id: 2 },
            tipHashes:       { rule: 'repeated', type: 'string', id: 4 },
            virtualDaaScore: { type: 'uint64', id: 9 },
            error:           { type: 'RPCError', id: 1000 },
          },
        },

        // ──────────────────────── NotifyBlockAdded (subscription) ──────────
        NotifyBlockAddedRequestMessage:  { fields: {} },
        NotifyBlockAddedResponseMessage: {
          fields: { error: { type: 'RPCError', id: 1000 } },
        },
        BlockAddedNotificationMessage: {
          fields: { block: { type: 'RpcBlock', id: 3 } },
        },

        // ──────────────────────── GetInfo ──────────────────────────────────
        GetInfoRequestMessage: { fields: {} },
        GetInfoResponseMessage: {
          fields: {
            p2pId:         { type: 'string', id: 1 },
            mempoolSize:   { type: 'uint64', id: 2 },
            serverVersion: { type: 'string', id: 3 },
            isSynced:      { type: 'bool',   id: 5 },
            error:         { type: 'RPCError', id: 1000 },
          },
        },

        // ──────────────────────── EstimateNetworkHashesPerSecond ───────────
        EstimateNetworkHashesPerSecondRequestMessage: {
          fields: {
            windowSize: { type: 'uint32', id: 1 },
            startHash:  { type: 'string', id: 2 },
          },
        },
        EstimateNetworkHashesPerSecondResponseMessage: {
          fields: {
            networkHashesPerSecond: { type: 'uint64', id: 1    },
            error:                  { type: 'RPCError', id: 1000 },
          },
        },

        // ──────────────────────── KaspadMessage (envelope) ─────────────────
        // Field numbers match the canonical messages.proto from kaspanet/kaspad.
        KaspadMessage: {
          oneofs: {
            payload: {
              oneof: [
                'notifyBlockAddedRequest',
                'notifyBlockAddedResponse',
                'blockAddedNotification',
                'getBlockRequest',
                'getBlockResponse',
                'getBlockDagInfoRequest',
                'getBlockDagInfoResponse',
                'getInfoRequest',
                'getInfoResponse',
                'estimateNetworkHashesPerSecondRequest',
                'estimateNetworkHashesPerSecondResponse',
              ],
            },
          },
          fields: {
            notifyBlockAddedRequest:  { type: 'NotifyBlockAddedRequestMessage',  id: 1007 },
            notifyBlockAddedResponse: { type: 'NotifyBlockAddedResponseMessage', id: 1008 },
            blockAddedNotification:   { type: 'BlockAddedNotificationMessage',   id: 1009 },
            getBlockRequest:          { type: 'GetBlockRequestMessage',          id: 1025 },
            getBlockResponse:         { type: 'GetBlockResponseMessage',         id: 1026 },
            getBlockDagInfoRequest:   { type: 'GetBlockDagInfoRequestMessage',   id: 1035 },
            getBlockDagInfoResponse:  { type: 'GetBlockDagInfoResponseMessage',  id: 1036 },
            getInfoRequest:           { type: 'GetInfoRequestMessage',           id: 1063 },
            getInfoResponse:          { type: 'GetInfoResponseMessage',          id: 1064 },
            estimateNetworkHashesPerSecondRequest:  { type: 'EstimateNetworkHashesPerSecondRequestMessage',  id: 1072 },
            estimateNetworkHashesPerSecondResponse: { type: 'EstimateNetworkHashesPerSecondResponseMessage', id: 1073 },
          },
        },
      },
    },
  },
}

const protoRoot = $protobuf.Root.fromJSON(descriptor as $protobuf.INamespace)

export const KaspadMessageType = protoRoot.lookupType('protowire.KaspadMessage')

/** Decode options: convert int64/uint64 to plain JS numbers */
export const DECODE_OPTS: $protobuf.IConversionOptions = { longs: Number, defaults: true }

/** Encode a KaspadMessage and return the raw protobuf bytes. */
export function encodeMessage(payload: Record<string, unknown>): Uint8Array {
  const err = KaspadMessageType.verify(payload)
  if (err) throw new Error(`KaspadMessage verify: ${err}`)
  return KaspadMessageType.encode(KaspadMessageType.create(payload)).finish() as Uint8Array
}

/** Decode raw protobuf bytes into a plain-object KaspadMessage. */
export function decodeMessage(bytes: Uint8Array): Record<string, unknown> {
  const msg = KaspadMessageType.decode(bytes)
  return KaspadMessageType.toObject(msg, DECODE_OPTS) as Record<string, unknown>
}
