on run
	startTrackLabConnector()
end run

on open location tracklabUrl
	startTrackLabConnector()
end open location

on startTrackLabConnector()
	tell application "Terminal"
		activate
		do script "zsh '/Users/rinzellhicks/Documents/Playground/wattbike-bmx-race/scripts/tracklab-start-local.zsh'"
	end tell
end startTrackLabConnector
