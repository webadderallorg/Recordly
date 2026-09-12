{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
  appimageTools,
  version,
  releaseHashes,
}:
let
  source =
    releaseHashes.${stdenvNoCC.hostPlatform.system}
      or (throw "Recordly is packaged for aarch64-darwin, x86_64-darwin, and x86_64-linux");

  src = fetchurl {
    url = "https://github.com/webadderallorg/Recordly/releases/download/v${version}/Recordly-${source.arch}.${source.extension}";
    hash = source.hash;
  };

  meta = {
    description = "Open-source screen recorder and editor for polished product demos";
    homepage = "https://www.recordly.dev";
    changelog = "https://github.com/webadderallorg/Recordly/releases/tag/v${version}";
    license = lib.licenses.agpl3Only;
    platforms = [
      "aarch64-darwin"
      "x86_64-darwin"
      "x86_64-linux"
    ];
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
  };
in
if stdenvNoCC.hostPlatform.isDarwin then
  stdenvNoCC.mkDerivation {
    pname = "recordly";
    inherit version src meta;

    nativeBuildInputs = [
      unzip
    ];

    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    unpackPhase = ''
      runHook preUnpack
      unzip -q "$src"
      runHook postUnpack
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications"
      cp -R Recordly.app "$out/Applications/"
      runHook postInstall
    '';
  }
else
  appimageTools.wrapType2 {
    pname = "recordly";
    inherit version src meta;
  }
