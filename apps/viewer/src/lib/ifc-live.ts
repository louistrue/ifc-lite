import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { WebsocketProvider } from "y-websocket";

const DEFAULT_RELAY = "wss://ifc-live-relay.louis-truempler.workers.dev";
const relayBase = import.meta.env.VITE_WS_RELAY_URL || DEFAULT_RELAY;

export interface IFCLiveSession {
  ydoc: Y.Doc;
  wsProvider: WebsocketProvider;
  webrtcProvider: WebrtcProvider;
  awareness: WebsocketProvider["awareness"];
  bcfTopics: Y.Map<unknown>;
  roomConfig: Y.Map<unknown>;
  destroy: () => void;
}

export function createSession(
  roomId: string,
  userName: string,
  role: "editor" | "spectator" = "editor"
): IFCLiveSession {
  const ydoc = new Y.Doc();

  const wsProvider = new WebsocketProvider(`${relayBase}/room`, roomId, ydoc);
  const webrtcProvider = new WebrtcProvider(roomId, ydoc, {
    signaling: ["wss://signaling.yjs.dev"],
  });
  const awareness = wsProvider.awareness;

  awareness.setLocalStateField("user", {
    name: userName,
    color: randomColor(),
    role,
  });

  const bcfTopics = ydoc.getMap("bcfTopics");
  const roomConfig = ydoc.getMap("roomConfig");

  wsProvider.on("status", ({ status }: { status: string }) => {
    console.log(`[IFC Live] WebSocket: ${status}`);
  });

  wsProvider.on("sync", (synced: boolean) => {
    console.log(`[IFC Live] Synced: ${synced}`);
  });

  awareness.on("change", () => {
    console.log(`[IFC Live] Peers: ${awareness.getStates().size}`);
  });

  return {
    ydoc,
    wsProvider,
    webrtcProvider,
    awareness,
    bcfTopics,
    roomConfig,
    destroy: () => {
      wsProvider.destroy();
      webrtcProvider.destroy();
      ydoc.destroy();
    },
  };
}

function randomColor(): string {
  const colors = [
    "#3B82F6",
    "#EF4444",
    "#10B981",
    "#F59E0B",
    "#8B5CF6",
    "#EC4899",
    "#14B8A6",
    "#F97316",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
