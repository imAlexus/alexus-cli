import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import spawn from "cross-spawn";
import { PACKAGE_VERSION } from "../utils/version.js";

const REPOSITORY = "imAlexus/alexus-cli";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface GitHubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}
export interface UpdateOptions {
  check?: boolean;
  force?: boolean;
  version?: string;
}

function versionParts(version: string): number[] {
  const normalized = version.replace(/^v/, "").split("-")[0];
  if (!normalized || !/^\d+(?:\.\d+){0,2}$/.test(normalized))
    throw new Error(`Versione non valida: ${version}`);
  return normalized.split(".").map(Number);
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function verifyPackageChecksum(data: Uint8Array, checksumFile: string): boolean {
  const expected = checksumFile.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(data).digest("hex");
  return Boolean(expected && expected === actual);
}

async function fetchRelease(version?: string): Promise<GitHubRelease> {
  const tag = version ? (version.startsWith("v") ? version : `v${version}`) : undefined;
  if (tag && !/^v\d+(?:\.\d+){0,2}$/.test(tag)) throw new Error(`Versione non valida: ${version}`);
  const endpoint = tag
    ? `https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`
    : `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Alexus-CLI/${PACKAGE_VERSION}`,
    },
  });
  if (!response.ok)
    throw new Error(`Impossibile controllare gli aggiornamenti (${response.status}).`);
  return (await response.json()) as GitHubRelease;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": `Alexus-CLI/${PACKAGE_VERSION}` } });
  if (!response.ok) throw new Error(`Download aggiornamento non riuscito (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

async function runNpmInstall(packageFile: string): Promise<void> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["install", "--global", packageFile, "--omit=dev"], {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ha terminato con codice ${String(code)}.`));
    });
  });
}

export async function updateAlexus(options: UpdateOptions = {}): Promise<void> {
  console.log("Controllo aggiornamenti Alexus…");
  const release = await fetchRelease(options.version);
  const targetVersion = release.tag_name.replace(/^v/, "");
  const comparison = compareVersions(targetVersion, PACKAGE_VERSION);
  if (options.check) {
    console.log(
      comparison > 0
        ? `Aggiornamento disponibile: ${PACKAGE_VERSION} → ${targetVersion}`
        : `Alexus CLI ${PACKAGE_VERSION} è aggiornato.`,
    );
    return;
  }
  if (comparison <= 0 && !options.force) {
    console.log(`Alexus CLI ${PACKAGE_VERSION} è già aggiornato.`);
    return;
  }
  const packageName = `alexus-cli-${targetVersion}.tgz`;
  const packageAsset = release.assets.find((asset) => asset.name === packageName);
  const checksumAsset = release.assets.find((asset) => asset.name === `${packageName}.sha256`);
  if (!packageAsset || !checksumAsset)
    throw new Error(`La release ${release.tag_name} non contiene pacchetto e checksum richiesti.`);

  const temporary = await mkdtemp(path.join(tmpdir(), "alexus-update-"));
  try {
    console.log(`Download Alexus CLI ${targetVersion}…`);
    const [packageData, checksumData] = await Promise.all([
      download(packageAsset.browser_download_url),
      download(checksumAsset.browser_download_url),
    ]);
    if (!verifyPackageChecksum(packageData, Buffer.from(checksumData).toString("utf8")))
      throw new Error("Checksum SHA-256 non valido. Aggiornamento interrotto.");
    const packageFile = path.join(temporary, packageName);
    await writeFile(packageFile, packageData);
    console.log("Checksum verificato. Installazione…");
    await runNpmInstall(packageFile);
    console.log(`Alexus CLI aggiornato: ${PACKAGE_VERSION} → ${targetVersion}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
