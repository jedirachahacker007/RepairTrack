using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RepairTrack.Models;

namespace RepairTrack.Controllers;

/// <summary>
/// Proxy for the RepairTrack data only. This controller never reads or writes
/// any Firebase node except <c>repair-data</c>.
/// </summary>
[ApiController]
[Route("api/repair-data")]
public class RepairDataController : ControllerBase
{
    private const string RepairDataNode = "repair-data";

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var json = await FirebaseDb.GetRawAsync(RepairDataNode);

        if (json is null)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                error = "ไม่สามารถอ่านข้อมูล repair-data จาก Firebase ได้"
            });
        }

        return Content(json, "application/json; charset=utf-8");
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] JsonElement payload)
    {
        var result = await FirebaseDb.SetAsync(RepairDataNode, payload);

        if (!result.ok)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                success = false,
                error = result.error
            });
        }

        return Ok(new { success = true, savedAt = DateTimeOffset.UtcNow });
    }
}
