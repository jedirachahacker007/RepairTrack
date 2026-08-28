using System.Net.Http;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace RepairTrack.Models
{
    // เชื่อมกับ Firebase Realtime Database ตรงๆแบบง่ายที่สุด (ไม่มี auth เพราะ rules เปิด read/write ไว้แล้ว)
    // Base URL: https://kcjsondata-default-rtdb.asia-southeast1.firebasedatabase.app
    //
    // ตัว DB นี้ใช้ร่วมกับหลายโปรเจค (มี node อื่นเช่น machines, spec_order ฯลฯ ที่ไม่เกี่ยวกับ
    // RepairTrack) ดังนั้นโปรเจคนี้แตะแค่ node "repair-data" เท่านั้น — ดู RepairDataController
    // ที่เป็นจุดเดียวที่เรียกใช้คลาสนี้ และมันล็อค node ไว้ที่ "repair-data" เสมอ
    public static class FirebaseDb
    {
        private const string BaseUrl = "https://kcjsondata-default-rtdb.asia-southeast1.firebasedatabase.app";
        private static readonly HttpClient Http = new();

        private static readonly JsonSerializerOptions WriteOptions = new()
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping // เก็บข้อความไทยแบบอ่านได้ ไม่ escape เป็น \u
        };

        private static readonly JsonSerializerOptions ReadOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        // อ่านข้อมูลจาก node เช่น "repair-data" -> GET {BaseUrl}/repair-data.json
        // คืนค่า null ถ้า node ยังไม่มีข้อมูล หรือเชื่อมต่อไม่ได้ (ผู้เรียกจะใช้ค่า default/seed แทน)
        public static async Task<T?> GetAsync<T>(string node) where T : class
        {
            try
            {
                var json = await Http.GetStringAsync($"{BaseUrl}/{node}.json");
                if (string.IsNullOrWhiteSpace(json) || json == "null") return null;
                return JsonSerializer.Deserialize<T>(json, ReadOptions);
            }
            catch
            {
                return null;
            }
        }

        // เหมือน GetAsync แต่คืนค่าเป็น JSON ดิบ (string) แทนการ deserialize —
        // ใช้ตอนที่แค่ต้องการส่งข้อมูลต่อให้ front-end โดยไม่ต้องแปลงเป็น type ใดๆ
        // (เช่น JsonElement ที่เป็น struct เลยใช้กับ GetAsync<T> ด้านบนไม่ได้)
        public static async Task<string?> GetRawAsync(string node)
        {
            try
            {
                var json = await Http.GetStringAsync($"{BaseUrl}/{node}.json");
                if (string.IsNullOrWhiteSpace(json) || json == "null") return null;
                return json;
            }
            catch
            {
                return null;
            }
        }

        // เขียนข้อมูลทับทั้ง node เช่น "repair-data" -> PUT {BaseUrl}/repair-data.json
        public static async Task<(bool ok, string error)> SetAsync<T>(string node, T data)
        {
            try
            {
                var json = JsonSerializer.Serialize(data, WriteOptions);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var res = await Http.PutAsync($"{BaseUrl}/{node}.json", content);
                if (res.IsSuccessStatusCode)
                {
                    return (true, "");
                }

                return (false, $"Firebase ตอบกลับ HTTP {(int)res.StatusCode}");
            }
            catch (Exception ex)
            {
                return (false, $"เชื่อมต่อ Firebase ไม่สำเร็จ: {ex.Message}");
            }
        }
    }
}
