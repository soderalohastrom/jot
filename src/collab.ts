import crypto from "node:crypto";
import { IdList, ElementIdGenerator, type ElementId, type SavedIdList } from "articulated";

export type InsertOp = {
  type: "insert";
  afterId: ElementId | null;
  startId: ElementId;
  chars: string;
};

export type DeleteOp = {
  type: "delete";
  startId: ElementId;
  count: number;
};

export type Op = InsertOp | DeleteOp;

export type SerializedOp = Op & {
  serverSeq: number;
  clientId: string;
  timestamp: string;
};

export type CollabState = {
  idList: IdList;
  chars: Map<string, string>;
  serverSeq: number;
  opLog: SerializedOp[];
};

export type SavedCollabState = {
  idListState: SavedIdList;
  chars: Array<{ bunchId: string; startCounter: number; chars: string }>;
  serverSeq: number;
};

function charKey(id: ElementId) {
  return `${id.bunchId}:${id.counter}`;
}

export function newCollabState(): CollabState {
  return {
    idList: IdList.new(),
    chars: new Map(),
    serverSeq: 0,
    opLog: [],
  };
}

export function collabFromMarkdown(markdown: string): CollabState {
  const state = newCollabState();
  if (!markdown) {
    return state;
  }

  const bunchId = crypto.randomUUID();
  const startId: ElementId = { bunchId, counter: 0 };
  state.idList = state.idList.insertAfter(null, startId, markdown.length);
  for (let i = 0; i < markdown.length; i++) {
    state.chars.set(charKey({ bunchId, counter: i }), markdown[i]);
  }

  return state;
}

export function collabToMarkdown(state: CollabState): string {
  const result: string[] = [];
  for (const id of state.idList.values()) {
    const char = state.chars.get(charKey(id));
    if (char !== undefined) {
      result.push(char);
    }
  }
  return result.join("");
}

export function applyOp(state: CollabState, op: Op): CollabState {
  if (op.type === "insert") {
    let newIdList = state.idList.insertAfter(op.afterId, op.startId, op.chars.length);
    const newChars = new Map(state.chars);
    for (let i = 0; i < op.chars.length; i++) {
      const id: ElementId = { bunchId: op.startId.bunchId, counter: op.startId.counter + i };
      newChars.set(charKey(id), op.chars[i]);
    }
    return { ...state, idList: newIdList, chars: newChars };
  }

  if (op.type === "delete") {
    let newIdList = state.idList.delete(op.startId, op.count);
    return { ...state, idList: newIdList };
  }

  return state;
}

export function applyOpToServer(state: CollabState, op: Op, clientId: string): CollabState {
  const newState = applyOp(state, op);
  newState.serverSeq = state.serverSeq + 1;
  const serialized: SerializedOp = {
    ...op,
    serverSeq: newState.serverSeq,
    clientId,
    timestamp: new Date().toISOString(),
  };
  newState.opLog = [...state.opLog, serialized];
  return newState;
}

export function saveCollabState(state: CollabState): SavedCollabState {
  const charBunches: Array<{ bunchId: string; startCounter: number; chars: string }> = [];
  const savedIdList = state.idList.save();

  for (const entry of savedIdList) {
    let chars = "";
    for (let i = 0; i < entry.count; i++) {
      const id: ElementId = { bunchId: entry.bunchId, counter: entry.startCounter + i };
      chars += state.chars.get(charKey(id)) || "\0";
    }
    charBunches.push({ bunchId: entry.bunchId, startCounter: entry.startCounter, chars });
  }

  return {
    idListState: savedIdList,
    chars: charBunches,
    serverSeq: state.serverSeq,
  };
}

export function loadCollabState(saved: SavedCollabState): CollabState {
  const idList = IdList.load(saved.idListState);
  const chars = new Map<string, string>();

  for (const bunch of saved.chars) {
    for (let i = 0; i < bunch.chars.length; i++) {
      const id: ElementId = { bunchId: bunch.bunchId, counter: bunch.startCounter + i };
      chars.set(charKey(id), bunch.chars[i]);
    }
  }

  return {
    idList,
    chars,
    serverSeq: saved.serverSeq,
    opLog: [],
  };
}

export function idAtIndex(state: CollabState, index: number): ElementId {
  return state.idList.at(index);
}

export function idBeforeIndex(state: CollabState, index: number): ElementId | null {
  if (index <= 0) {
    return null;
  }
  return state.idList.at(index - 1);
}

export function cursorToId(state: CollabState, index: number): ElementId | null {
  return state.idList.cursorAt(index);
}

export function idToCursor(state: CollabState, id: ElementId | null): number {
  return state.idList.cursorIndex(id);
}
