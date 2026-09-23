cask "recordly" do
  arch arm: "arm64", intel: "x64"

  version "1.3.3"
  sha256 arm:   "7fa8f4116e870d40fd78bb36d2ad20af364c945023b7b5ec3e72b568b6bbdee5",
         intel: "35e49a0bf7afbca771b12fc99a834a287cbcb2e47bc9be07c4e56cbdd2923f85"

  url "https://github.com/webadderallorg/Recordly/releases/download/v#{version}/Recordly-#{arch}.dmg"
  name "Recordly"
  desc "Creator-focused screen recorder with auto-zoom, cursor effects, and more"
  homepage "https://github.com/webadderallorg/Recordly"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Recordly.app"

  zap trash: [
    "~/Library/Application Support/Recordly",
    "~/Library/Preferences/dev.recordly.app.plist",
    "~/Library/Saved Application State/dev.recordly.app.savedState",
  ]
end
