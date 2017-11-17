# Chromecast for Homey
Cast a YouTube video, a regular video/audio url or a webpage to your Chromecast device via flows.

# Homey Music (compatible with Homey v1.2.0 and higher)
**Note. To let Homey use your Chromecast as a speaker a re-pair is required. Please delete your Chromecast device in Homey and add it again.**
Chromecast now also supports Homey Music! This makes it possible to play playlists from Homey Media to your Chromecast. 
Features of this app in combination with Homey Media include:
Play tracks from the Google Play Music/Soundcloud app to Chromecast
Play mixed source playlists from Homey Music

## What's new

#### v3.1.2
Sanitize spaces when casting a website
fix formatting in readme

#### v3.1.1
Sanitize spaces when casting a video URL
fix formatting in readme

#### v3.1.0
Added new device entry "Chromecast Enabled Device" where all chromecast enabled devices are listed which are not chromecast-audio or chromecast-video.
Before these devices would be listed alongside the chromecast-video devices.

#### v3.0.0
Stable version of the chromecast app with Homey Music support. This version requires you to re-pair your chromecast devices when coming from version 2.1.0 or lower to use them as active speaker in Homey Music.

#### v2.2.4
Fixed some radio stations not being able to cast, Thanks to kerkenit for the fix!
Fixed cast video url flow card to be able to cast url's from the youtube app tag, Thanks to MarvinSchenkel for the fix!

#### v2.2.0
Added support for Homey Media
Various bug fixes

#### v2.1.0
Added support for Chromecast Audio Groups<br/>
You can now cast radio stations

#### v2.0.10
Added support for Chromecast enabled devices<br/>
Fixed bug where some Chromecast would not be able to cast Youtube videos<br/>
Fixed some bugs which caused the app to crash

#### v2.0.0
Complete rewrite of Chromecast app<br/>
New implementation of Youtube casting<br/> 
Now you can cast webpages<br/>
Fixed loads of bugs
