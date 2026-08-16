import Database from "better-sqlite3";

import { LATEST_METADATA_SCHEMA_VERSION } from "../metadata/database.js";

const METADATA_APPLICATION_ID = 0x57454245;

export interface MetadataVersionInspection {
  readonly applicationId: number;
  readonly applicationIdValid: boolean;
  readonly quickCheck: "ok";
  readonly supportedSchemaVersion: number;
  readonly userVersion: number;
}

export function supportedMetadataSchemaVersion(): number {
  return LATEST_METADATA_SCHEMA_VERSION;
}

export function inspectMetadataVersion(
  metadataDatabasePath: string,
): MetadataVersionInspection {
  const database = new Database(metadataDatabasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    const applicationId = database.pragma("application_id", {
      simple: true,
    }) as number;
    const userVersion = database.pragma("user_version", {
      simple: true,
    }) as number;
    const quickCheckRows = database.pragma("quick_check") as readonly {
      readonly quick_check: string;
    }[];
    const quickCheck = quickCheckRows.map(({ quick_check }) => quick_check);
    if (applicationId !== METADATA_APPLICATION_ID) {
      throw new Error("Metadata database application ID is not WebEditor");
    }
    if (quickCheck.length !== 1 || quickCheck[0] !== "ok") {
      throw new Error("Metadata database quick_check failed");
    }
    if (
      !Number.isSafeInteger(userVersion) ||
      userVersion < 1 ||
      userVersion > LATEST_METADATA_SCHEMA_VERSION
    ) {
      throw new Error(
        `Metadata schema ${String(userVersion)} is incompatible with supported version ${String(LATEST_METADATA_SCHEMA_VERSION)}`,
      );
    }
    return {
      applicationId,
      applicationIdValid: true,
      quickCheck: "ok",
      supportedSchemaVersion: LATEST_METADATA_SCHEMA_VERSION,
      userVersion,
    };
  } finally {
    database.close();
  }
}
