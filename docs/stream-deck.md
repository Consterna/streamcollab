**English** | [Español](stream-deck.es.md)

# Stream Deck & Streamer.bot

Besides the Dock buttons, the `1`..`5` keys and the OBS global hotkeys, any device or tool that can send an
HTTP request can drop markers into your squad session. This is handy for an Elgato Stream Deck, a macro pad,
Streamer.bot or Touch Portal.

## 1. Get your credentials

Open your **StreamCollab Dock** in OBS, click **OBS Linked / OBS Disconnected** to expand the settings panel and
look at the **HTTP token** row:

| Value | Where to find it |
| --- | --- |
| Server URL | Your StreamCollab address, e.g. `https://collab.example.com` |
| Room code | The `room=` value in your Dock URL, e.g. `KQ7P-M3XD` |
| Member id | Shown in the **HTTP token** row, e.g. `mem_k3j9x2a` |
| Member token | **Copy** button in the **HTTP token** row |

The member token identifies *your* Dock: markers sent with it appear under your name, and nobody else can use your
member id. Keep it private, like a password. If you clear the Dock's browser data you get a new member id and token.

The same member id and token work in every room your Dock has joined.

## 2. The two requests

**Create a marker**

```http
POST {server}/api/rooms/{room}/quick-mark
Authorization: Bearer {member token}
Content-Type: application/json

{ "memberId": "{member id}", "category": "kill", "label": "Ace" }
```

| Field | Required | Values |
| --- | --- | --- |
| `memberId` | yes | Your member id |
| `category` | yes | `kill`, `wipe`, `clutch`, `funny`, `note`, `custom` |
| `label` | yes | Up to 80 characters |
| `comment` | no | Up to 280 characters |
| `color` | no | DaVinci color (`Red`, `Fuchsia`, `Yellow`, `Cyan`, `Blue`, `Green`, ...). Defaults per category |
| `tags` | no | Up to 10 short strings |

Answers `201` with the stored marker (timecode included).

**Undo your last marker**

```http
POST {server}/api/rooms/{room}/markers/undo
Authorization: Bearer {member token}
Content-Type: application/json

{ "memberId": "{member id}" }
```

Answers `200` with `{ "removed": { ...marker } }`, or `404` if you have no marker to undo in the current session.

Both endpoints accept 60 requests per minute per IP, which is plenty for button presses.

> HTTP markers are timestamped when the server receives them. Docks, OBS hotkeys and the `1`..`5` keys are a
> little more precise: they use your clock calibrated against the server and your exact OBS recording position.
> Native OBS chapters are only written by the Dock, so press the Dock / hotkey when you want a chapter in your file.

If no session is running when a marker arrives, the server starts an *Auto Session* for it (named `Auto Session`
plus the server's local time). Only the host can stop it.

## 3. Test from a terminal

```powershell
$headers = @{ Authorization = 'Bearer YOUR_MEMBER_TOKEN' }
$body = @{ memberId = 'YOUR_MEMBER_ID'; category = 'clutch'; label = 'Clutch 1v3' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark' `
  -Headers $headers -ContentType 'application/json' -Body $body
```

```bash
curl -X POST "https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark" \
  -H "Authorization: Bearer YOUR_MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"memberId":"YOUR_MEMBER_ID","category":"clutch","label":"Clutch 1v3"}'
```

## 4. Elgato Stream Deck

Stream Deck has no built-in HTTP POST action, so install a plugin from the Elgato Marketplace that can send
HTTP requests **with custom headers and a JSON body** (for example *API Monkey*). For each key:

1. Method `POST`, URL `https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark`.
2. Headers: `Authorization: Bearer YOUR_MEMBER_TOKEN` and `Content-Type: application/json`.
3. Body: `{"memberId":"YOUR_MEMBER_ID","category":"kill","label":"Kill"}` (change category / label per key).

Add one more key with the `/markers/undo` URL and body `{"memberId":"YOUR_MEMBER_ID"}` as an "oops" button.

## 5. Streamer.bot

Streamer.bot's **Fetch URL** sub-action only does simple requests; for POST with headers use an
**Execute C# Code** sub-action, as described in the Streamer.bot docs ([Advanced "Fetch URL"](https://docs.streamer.bot/examples/http-post)):

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

public class CPHInline
{
    // Fill these in once
    private const string Server = "https://collab.example.com";
    private const string Room = "KQ7P-M3XD";
    private const string MemberId = "YOUR_MEMBER_ID";
    private const string MemberToken = "YOUR_MEMBER_TOKEN";

    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

    public bool Execute()
    {
        // Set "category" / "label" as action arguments, e.g. from a chat command or a hotkey trigger
        string category = args.ContainsKey("category") ? args["category"].ToString() : "note";
        string label = args.ContainsKey("label") ? args["label"].ToString() : "Streamer.bot";

        string json = "{\"memberId\":\"" + MemberId + "\",\"category\":\"" + category + "\",\"label\":\""
            + label.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";

        var request = new HttpRequestMessage(HttpMethod.Post, Server + "/api/rooms/" + Room + "/quick-mark");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MemberToken);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");

        HttpResponseMessage response = Http.SendAsync(request).GetAwaiter().GetResult();
        CPH.LogInfo("StreamCollab quick-mark: " + (int)response.StatusCode);
        return response.IsSuccessStatusCode;
    }
}
```

## Troubleshooting

| Response | Meaning |
| --- | --- |
| `403 Member token required` | Wrong / missing token, the member id belongs to another Dock, or your Dock has never joined this room |
| `404 Room ... not found` | Wrong room code (any letter case works: `kq7p-m3xd` is the same room as `KQ7P-M3XD`) |
| `400 ...` | Invalid body: the message names the field (e.g. `category: Invalid option`) |
| `429` | More than 60 requests per minute from your IP |
