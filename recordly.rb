cask "recordly" do
  arch arm: "arm64", intel: "x64"

  version "1.2.1"
  sha256 arm:   "f9d1c5874ec009725a93338edce3fe511537ec0348113914b92577c01214d07b",
         intel: "aa89cf4fc6338dcb22eb6b1d2fc920a1cf6e5066742687463a426f1ac31bde84"

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
