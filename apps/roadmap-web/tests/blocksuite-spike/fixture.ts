import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { AffineSchemas } from "@blocksuite/blocks/schemas";
import { DocCollection, Schema, Text, type Doc } from "@blocksuite/store";
import { applyUpdate, encodeStateAsUpdate } from "yjs";

export const FIXTURE_DOCUMENT_ID = "blocksuite-0.19.5-space-doc";

const fixtureUrl = new URL("./fixtures/affine-0.19.5-space-doc.base64", import.meta.url);

export type SemanticBlock = {
  id: string;
  flavour: string;
  parentId: string | null;
  children: string[];
  text: string | null;
  title: string | null;
};

export function createUnloadedDocument(id = FIXTURE_DOCUMENT_ID): Doc {
  const schema = new Schema();
  schema.register(AffineSchemas);
  const collection = new DocCollection({ id: `collection-${id}`, schema });
  collection.meta.initialize();
  return collection.createDoc({ id });
}

export function createSyntheticFixtureDocument(): Doc {
  const doc = createUnloadedDocument();
  doc.load(() => {
    const pageId = doc.addBlock("affine:page", { title: new Text("Synthetic meeting plan") });
    doc.addBlock("affine:surface", {}, pageId);
    const noteId = doc.addBlock("affine:note", {}, pageId);
    doc.addBlock(
      "affine:paragraph",
      { text: new Text("Decide the next deterministic step.") },
      noteId,
    );
  });
  return doc;
}

export function semanticSnapshot(doc: Doc): SemanticBlock[] {
  return doc
    .getBlocks()
    .map((model) => {
      const block = model as typeof model & {
        children?: Array<{ id: string }>;
        text?: { toString(): string };
        title?: { toString(): string };
      };
      return {
        id: block.id,
        flavour: block.flavour,
        parentId: doc.getParent(model)?.id ?? null,
        children: block.children?.map((child) => child.id) ?? [],
        text: block.text?.toString() ?? null,
        title: block.title?.toString() ?? null,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function encodeSpaceDoc(doc: Doc): Uint8Array {
  return encodeStateAsUpdate(doc.spaceDoc);
}

export async function readFixtureBytes(): Promise<Uint8Array> {
  const encoded = (await readFile(fixtureUrl, "utf8")).trim();
  return Uint8Array.from(Buffer.from(encoded, "base64"));
}

export async function hashFixture(): Promise<string> {
  return createHash("sha256").update(await readFixtureBytes()).digest("hex");
}

export async function restoreFixture(): Promise<Doc> {
  const doc = createUnloadedDocument();
  applyUpdate(doc.spaceDoc, await readFixtureBytes());
  doc.load();
  return doc;
}
