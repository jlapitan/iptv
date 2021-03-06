const fs = require("fs")
const path = require('path')
const parser = require('iptv-playlist-parser')
const axios = require('axios')
const zlib = require("zlib")
const DOMParser = require('xmldom').DOMParser
const urlParser = require('url')

const supportedCategories = [ 'Auto','Business', 'Classic','Comedy','Documentary','Education','Entertainment', 'Family','Fashion','Food', 'General', 'Health', 'History', 'Hobby', 'Kids', 'Legislative','Lifestyle','Local', 'Movies', 'Music', 'News', 'Quiz', 'Religious','Sci-Fi', 'Shop', 'Sport', 'Travel', 'Weather', 'XXX' ]

const blacklist = [
  '80.80.160.168', // repeats on a loop
  '63.237.48.3', // not a live stream
  '189.216.247.113', // not working streams
]

let cache = {}

class Playlist {
  constructor(data) {
    this.header = data.header
    this.items = data.items
  }

  getHeader() {
    let parts = ['#EXTM3U']
    for(let key in this.header.attrs) {
      let value = this.header.attrs[key]
      if(value) {
        parts.push(`${key}="${value}"`)
      }
    }

    return `${parts.join(' ')}\n`
  }
}

class Channel {
  constructor(data) {
    this.id = data.tvg.id
    this.name = data.tvg.name
    this.logo = data.tvg.logo
    this.group = this._getGroup(data.group.title)
    this.url = data.url
    this.title = data.name
  }

  _getGroup(groupTitle) {
    if(!groupTitle) return ''
      
    const groupIndex = supportedCategories.map(g => g.toLowerCase()).indexOf(groupTitle.toLowerCase())

    if(groupIndex === -1) {
      groupTitle = ''
    } else {
      groupTitle = supportedCategories[groupIndex]
    }

    return groupTitle
  }

  toString() {
    const info = `-1 tvg-id="${this.id}" tvg-name="${this.name}" tvg-logo="${this.logo}" group-title="${this.group}",${this.title}`

    return '#EXTINF:' + info + '\n' + this.url + '\n'
  }
}

function parsePlaylist(filename) {
  const content = readFile(filename)
  const result = parser.parse(content)

  return new Playlist(result)
}

function createChannel(data) {
  return new Channel(data)
}

async function loadEPG(url) {
  const data = await getGzipped(url)
  const doc = new DOMParser().parseFromString(data, 'text/xml')
  const channelElements = doc.getElementsByTagName('channel')
  let channels = {}
  for(let i = 0; i < channelElements.length; i++) {
    let channel = {}
    let channelElement = channelElements[i]
    channel.id = channelElement.getAttribute('id')
    channel.names = []
    for(let nameElement of Object.values(channelElement.getElementsByTagName('display-name'))) {
      if(nameElement.firstChild) {
        channel.names.push(nameElement.firstChild.nodeValue)
      }
    }
    channel.names = channel.names.filter(n => n)
    const iconElements = channelElement.getElementsByTagName('icon')
    if(iconElements.length) {
      channel.icon = iconElements[0].getAttribute('src')
    }

    channels[channel.id] = channel
  }

  return Promise.resolve({ 
    url, 
    channels 
  })
}

function getGzipped(url) {
  const supportedTypes = ['application/x-gzip', 'application/octet-stream']

  return new Promise((resolve, reject) => {
    var buffer = []
    axios({
      method: 'get',
      url: url,
      responseType:'stream'
    }).then(res => {
      let stream
      if(supportedTypes.indexOf(res.headers['content-type']) > -1) {
        let gunzip = zlib.createGunzip()         
        res.data.pipe(gunzip)
        stream = gunzip
      } else {
        stream = res.data        
      }

      stream.on('data', function(data) {
        buffer.push(data.toString())
      }).on("end", function() {
        resolve(buffer.join(""))
      }).on("error", function(e) {
        reject(e)
      })
    }).catch(e => {
      reject(e)
    })
  })
}

function byTitleAndUrl(a, b) {
  var titleA = a.title.toLowerCase()
  var titleB = b.title.toLowerCase()
  var urlA = a.url.toLowerCase()
  var urlB = b.url.toLowerCase()
  
  if(titleA < titleB) return -1
  if(titleA > titleB) return 1

  if(urlA < urlB) return -1
  if(urlA > urlB) return 1

  return 0
}

function sortByTitleAndUrl(arr) {
  return arr.sort(byTitleAndUrl)
}

function readFile(filename) {
  return fs.readFileSync(path.resolve(__dirname) + `/../${filename}`, { encoding: "utf8" })
}

function appendToFile(filename, data) {
  fs.appendFileSync(path.resolve(__dirname) + '/../' + filename, data)
}

function createFile(filename, data) {
  fs.writeFileSync(path.resolve(__dirname) + '/../' + filename, data)
}

function getBasename(filename) {
  return path.basename(filename, path.extname(filename))
}

function addToCache(url) {
  let id = getUrlPath(url)

  cache[id] = true
}

function checkCache(url) {
  let id = getUrlPath(url)

  return cache.hasOwnProperty(id)
}

function clearCache() {
  cache = {}
}

function getUrlPath(u) {
  let parsed = urlParser.parse(u)
  let searchQuery = parsed.search || ''
  let path = parsed.host + parsed.pathname + searchQuery

  return path.toLowerCase()
}

function validateUrl(channelUrl) {
  const url = new URL(channelUrl)
  const host = url.hostname

  return blacklist.indexOf(host) === -1
}

function skipPlaylist(filename) {
  let testCountry = process.env.npm_config_country
  let excludeList = process.env.npm_config_exclude
  let excludeCountries = excludeList ? excludeList.split(',') : []
  
  if (testCountry && filename !== 'channels/' + testCountry + '.m3u') return true
  
  for(const countryCode of excludeCountries) {
    if (filename === 'channels/' + countryCode + '.m3u') return true
  }

  return false
}

module.exports = {
  parsePlaylist,
  sortByTitleAndUrl,
  appendToFile,
  createFile,
  readFile,
  loadEPG,
  createChannel,
  getBasename,
  addToCache,
  checkCache,
  clearCache,
  validateUrl,
  skipPlaylist,
  supportedCategories
}