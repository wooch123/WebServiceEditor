import type { MetadataDatabase } from "../metadata/database.js";
import { ElementRepository } from "./element-repository.js";

/**
 * Owns durable Layout Preset provenance while reusing the Element transaction
 * primitives needed to commit one atomic PRESET_APPLY command.
 */
export class LayoutPresetRepository extends ElementRepository {
  constructor(metadataDatabase: MetadataDatabase) {
    super(metadataDatabase);
  }
}
