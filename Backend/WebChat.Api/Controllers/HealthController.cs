using Microsoft.AspNetCore.Mvc;

namespace WebChat.Api.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new
        {
            Success = true,
            Message = "WebChat API is running",
            Version = "1.0.0",
            Timestamp = DateTime.UtcNow
        });
    }
}