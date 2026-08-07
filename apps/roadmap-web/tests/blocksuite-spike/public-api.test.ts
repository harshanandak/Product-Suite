import { AffineSchemas } from "@blocksuite/blocks/schemas";
import { DocCollection, Schema, Text } from "@blocksuite/store";
import { describe, expect, test } from "vitest";

import manifest from "../../package.json";

const BLOCKSUITE_PACKAGES = [
  "@blocksuite/affine-block-surface",
  "@blocksuite/affine-model",
  "@blocksuite/blocks",
  "@blocksuite/presets",
  "@blocksuite/store",
] as const;

describe("BlockSuite 0.19.5 public headless surface", () => {
  test("pins every direct BlockSuite dependency to the evaluated release", () => {
    for (const packageName of BLOCKSUITE_PACKAGES) {
      expect(manifest.dependencies[packageName]).toBe("0.19.5");
    }
  });

  test("constructs and loads an Affine document through public exports", async () => {
    const schema = new Schema();
    schema.register(AffineSchemas);

    const collection = new DocCollection({ id: "spike-collection", schema });
    collection.meta.initialize();
    const doc = collection.createDoc({ id: "spike-document" });

    let pageId = "";
    let paragraphId = "";
    await doc.load(() => {
      pageId = doc.addBlock("affine:page", { title: new Text("Spike") });
      const noteId = doc.addBlock("affine:note", {}, pageId);
      paragraphId = doc.addBlock(
        "affine:paragraph",
        { text: new Text("Public API") },
        noteId,
      );
    });

    const page = doc.getBlock(pageId);
    if (!page) throw new Error("page block was not created");
    doc.updateBlock(page.model, { title: new Text("Updated Spike") });

    expect(doc.id).toBe("spike-document");
    expect(doc.spaceDoc).toBeDefined();
    expect(
      (page.model as typeof page.model & { title: Text }).title.toString(),
    ).toBe("Updated Spike");
    expect(doc.getBlocksByFlavour("affine:paragraph").map((block) => block.id)).toEqual([
      paragraphId,
    ]);
  });
});
