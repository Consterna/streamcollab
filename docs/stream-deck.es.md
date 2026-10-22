[English](stream-deck.md) | **Español**

# Stream Deck y Streamer.bot

Además de los botones de la Dock, las teclas `1`..`5` y los atajos globales de OBS, cualquier dispositivo o
herramienta capaz de enviar una petición HTTP puede añadir marcadores a la sesión de tu squad. Viene bien para un
Elgato Stream Deck, un teclado de macros, Streamer.bot o Touch Portal.

## 1. Consigue tus credenciales

Abre tu **Dock de StreamCollab** en OBS, pulsa **OBS conectado / OBS desconectado** para desplegar el panel de
ajustes y busca la fila **Token HTTP**:

| Dato | Dónde encontrarlo |
| --- | --- |
| URL del servidor | Tu dirección de StreamCollab, p. ej. `https://collab.example.com` |
| Código de sala | El valor `room=` de la URL de tu Dock, p. ej. `KQ7P-M3XD` |
| Member id | Aparece en la fila **Token HTTP**, p. ej. `mem_k3j9x2a` |
| Member token | Botón **Copiar** de la fila **Token HTTP** |

El member token identifica a *tu* Dock: los marcadores enviados con él aparecen con tu nombre y nadie más puede usar
tu member id. Guárdalo en privado, como una contraseña. Si borras los datos de navegación de la Dock, obtendrás un
member id y un token nuevos.

El mismo member id y el mismo token sirven en todas las salas en las que haya entrado tu Dock.

## 2. Las dos peticiones

**Crear un marcador**

```http
POST {servidor}/api/rooms/{sala}/quick-mark
Authorization: Bearer {member token}
Content-Type: application/json

{ "memberId": "{member id}", "category": "kill", "label": "Ace" }
```

| Campo | Obligatorio | Valores |
| --- | --- | --- |
| `memberId` | sí | Tu member id |
| `category` | sí | `kill`, `wipe`, `clutch`, `funny`, `note`, `custom` |
| `label` | sí | Hasta 80 caracteres |
| `comment` | no | Hasta 280 caracteres |
| `color` | no | Color de DaVinci (`Red`, `Fuchsia`, `Yellow`, `Cyan`, `Blue`, `Green`, ...). Por defecto, el de la categoría |
| `tags` | no | Hasta 10 textos cortos |

Responde `201` con el marcador guardado (timecode incluido).

**Deshacer tu último marcador**

```http
POST {servidor}/api/rooms/{sala}/markers/undo
Authorization: Bearer {member token}
Content-Type: application/json

{ "memberId": "{member id}" }
```

Responde `200` con `{ "removed": { ...marcador } }`, o `404` si no tienes ningún marcador que deshacer en la sesión
actual.

Los dos endpoints admiten 60 peticiones por minuto por IP, más que suficiente para pulsar botones.

> Los marcadores HTTP llevan la hora en que los recibe el servidor. La Dock, los atajos de OBS y las teclas `1`..`5`
> son algo más precisos: usan tu reloj calibrado con el servidor y la posición exacta de tu grabación de OBS.
> Los capítulos nativos de OBS solo los escribe la Dock, así que usa la Dock o un atajo cuando quieras un capítulo
> en tu archivo.

Si no hay ninguna sesión en marcha cuando llega un marcador, el servidor inicia una *Auto Session* para él (llamada
`Auto Session` seguido de la hora local del servidor). Solo el host puede detenerla.

## 3. Pruébalo desde una terminal

```powershell
$headers = @{ Authorization = 'Bearer TU_MEMBER_TOKEN' }
$body = @{ memberId = 'TU_MEMBER_ID'; category = 'clutch'; label = 'Clutch 1v3' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark' `
  -Headers $headers -ContentType 'application/json' -Body $body
```

```bash
curl -X POST "https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark" \
  -H "Authorization: Bearer TU_MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"memberId":"TU_MEMBER_ID","category":"clutch","label":"Clutch 1v3"}'
```

## 4. Elgato Stream Deck

Stream Deck no trae una acción HTTP POST de serie, así que instala desde el Elgato Marketplace un plugin que pueda
enviar peticiones HTTP **con cabeceras propias y un cuerpo JSON** (por ejemplo *API Monkey*). Para cada tecla:

1. Método `POST`, URL `https://collab.example.com/api/rooms/KQ7P-M3XD/quick-mark`.
2. Cabeceras: `Authorization: Bearer TU_MEMBER_TOKEN` y `Content-Type: application/json`.
3. Cuerpo: `{"memberId":"TU_MEMBER_ID","category":"kill","label":"Kill"}` (cambia la categoría / etiqueta en cada tecla).

Añade una tecla más con la URL `/markers/undo` y el cuerpo `{"memberId":"TU_MEMBER_ID"}` como botón de "ups".

## 5. Streamer.bot

La sub-acción **Fetch URL** de Streamer.bot solo hace peticiones sencillas; para un POST con cabeceras usa una
sub-acción **Execute C# Code**, como explica la documentación de Streamer.bot ([Advanced "Fetch URL"](https://docs.streamer.bot/examples/http-post)):

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

public class CPHInline
{
    // Rellena estos datos una vez
    private const string Server = "https://collab.example.com";
    private const string Room = "KQ7P-M3XD";
    private const string MemberId = "TU_MEMBER_ID";
    private const string MemberToken = "TU_MEMBER_TOKEN";

    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

    public bool Execute()
    {
        // Define "category" / "label" como argumentos de la acción, p. ej. desde un comando de chat o un atajo
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

## Solución de problemas

| Respuesta | Significado |
| --- | --- |
| `403 Member token required` | Token incorrecto o ausente, el member id pertenece a otra Dock o tu Dock nunca ha entrado en esta sala |
| `404 Room ... not found` | Código de sala incorrecto (da igual mayúsculas o minúsculas: `kq7p-m3xd` es la misma sala que `KQ7P-M3XD`) |
| `400 ...` | Cuerpo no válido: el mensaje indica el campo (p. ej. `category: Invalid option`) |
| `429` | Más de 60 peticiones por minuto desde tu IP |
