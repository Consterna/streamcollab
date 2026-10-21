--[[
StreamCollab global hotkeys for OBS Studio.

Registers five frontend hotkeys (Settings -> Hotkeys -> "StreamCollab: ...") that work
while your game has focus. Each press writes { sc_category, sc_seq } into the settings of an
input named "StreamCollab Signal"; obs-websocket emits InputSettingsChanged and the
StreamCollab Dock turns it into a squad marker.

Install: Tools -> Scripts -> "+" -> select this file. Then bind keys in Settings -> Hotkeys.
The script only touches its own "StreamCollab Signal" input (created if missing, never
added to any scene, so it is never rendered).
]]

local obs = obslua

local SIGNAL_INPUT_NAME = "StreamCollab Signal"
local SIGNAL_INPUT_KIND = "color_source_v3"

local MARKERS = {
  { category = "kill",   description = "StreamCollab: Kill" },
  { category = "wipe",   description = "StreamCollab: Squad Wipe" },
  { category = "clutch", description = "StreamCollab: Clutch Play" },
  { category = "funny",  description = "StreamCollab: Funny Moment" },
  { category = "note",   description = "StreamCollab: Timeline Note" },
}

local hotkey_ids = {}
local signal_source = nil
local seq = 0

local function hotkey_name(category)
  return "streamcollab.marker." .. category
end

local function ensure_signal_source()
  if signal_source ~= nil then
    return signal_source
  end
  -- obs_get_source_by_name returns a new reference that we keep until unload
  signal_source = obs.obs_get_source_by_name(SIGNAL_INPUT_NAME)
  if signal_source == nil then
    signal_source = obs.obs_source_create(SIGNAL_INPUT_KIND, SIGNAL_INPUT_NAME, nil, nil)
  end
  return signal_source
end

local function send_signal(category)
  local source = ensure_signal_source()
  if source == nil then
    obs.script_log(obs.LOG_WARNING, "StreamCollab: could not create the '" .. SIGNAL_INPUT_NAME .. "' input")
    return
  end

  seq = seq + 1
  local settings = obs.obs_data_create()
  obs.obs_data_set_string(settings, "sc_category", category)
  -- Unique per press so the dock can ignore duplicate settings events
  obs.obs_data_set_int(settings, "sc_seq", os.time() * 1000 + (seq % 1000))
  obs.obs_source_update(source, settings)
  obs.obs_data_release(settings)
end

function script_description()
  return [[<b>StreamCollab Global Hotkeys</b><br/>
Mark kills, wipes, clutches, funny moments and notes while the game has focus.<br/>
Bind the keys in <i>Settings &rarr; Hotkeys</i> (search "StreamCollab").<br/>
The StreamCollab Dock must be open and linked to OBS.]]
end

function script_load(settings)
  ensure_signal_source()

  for _, marker in ipairs(MARKERS) do
    local category = marker.category
    local id = obs.obs_hotkey_register_frontend(hotkey_name(category), marker.description, function(pressed)
      if pressed then
        send_signal(category)
      end
    end)
    hotkey_ids[category] = id

    local saved = obs.obs_data_get_array(settings, hotkey_name(category))
    obs.obs_hotkey_load(id, saved)
    obs.obs_data_array_release(saved)
  end
end

function script_save(settings)
  for category, id in pairs(hotkey_ids) do
    local bindings = obs.obs_hotkey_save(id)
    obs.obs_data_set_array(settings, hotkey_name(category), bindings)
    obs.obs_data_array_release(bindings)
  end
end

function script_unload()
  if signal_source ~= nil then
    obs.obs_source_release(signal_source)
    signal_source = nil
  end
end
