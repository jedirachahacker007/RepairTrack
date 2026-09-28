using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using RepairTrack.Models;

namespace RepairTrack.Controllers;

public class HomeController : Controller
{
    [Route("/")]
    [Route("Index")]
    public IActionResult Index()
    {
        return View();
    }

    [Route("Dashboard")]
    public IActionResult Dashboard()
    {
        return View();
    }

    [Route("RepairDetail")]
    public IActionResult RepairDetail()
    {
        return View();
    }

    public IActionResult RepairMonitor()
    {
        return View("repair-monitor");
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}