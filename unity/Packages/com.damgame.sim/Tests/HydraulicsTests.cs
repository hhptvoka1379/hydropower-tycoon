// Compares the C# port with golden values exported from the JavaScript reference
// by tools/export_hydraulics.mjs. Expected values come only from the golden file.
using System;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace DamGame.Sim.Tests
{
    [TestFixture]
    public sealed class HydraulicsTests
    {
        private const double RelTol = 1e-9;
        private const double AbsFloor = 1e-12;

        private static JObject _golden;
        private static Hydraulics _hy;

        [OneTimeSetUp]
        public void LoadGolden()
        {
            string path = FindGolden();
            _golden = JObject.Parse(File.ReadAllText(path));
            var c = (JObject)_golden["constants"];
            _hy = new Hydraulics(new HydraulicsConstants(
                Rho: D(c["rho"]),
                G: D(c["g"]),
                Nu: D(c["nu"]),
                SwameeA: D(c["swameeA"]),
                SwameeB: D(c["swameeB"]),
                SwameeExp: D(c["swameeExp"]),
                FMin: D(c["f_min"]),
                FMax: D(c["f_max"]),
                ReTurbulent: D(c["Re_turbulent"]),
                FLowRe: D(c["f_lowRe"])));
        }

        // Next to the test assembly (dotnet test copies it), else next to this source file (Unity).
        private static string FindGolden([CallerFilePath] string sourceFile = "")
        {
            string[] candidates =
            {
                Path.Combine(TestContext.CurrentContext.TestDirectory, "golden", "hydraulics.json"),
                Path.Combine(Path.GetDirectoryName(sourceFile) ?? "", "golden", "hydraulics.json"),
            };
            foreach (string p in candidates)
                if (File.Exists(p)) return p;
            throw new FileNotFoundException("golden/hydraulics.json not found; run node tools/export_hydraulics.mjs. Looked in: "
                + string.Join(", ", candidates));
        }

        private static double D(JToken t) => t.Value<double>();

        private static double[] Args(JToken c) => c["args"].Select(D).ToArray();

        private static JArray Cases(string fn)
        {
            var cases = (JArray)_golden[fn]["cases"];
            Assert.That(cases.Count, Is.EqualTo(201), $"{fn}: expected 200 seeded cases plus 1 edge case");
            return cases;
        }

        private static void AssertClose(double expected, double actual, string label)
        {
            double tol = Math.Max(AbsFloor, RelTol * Math.Abs(expected));
            double diff = Math.Abs(actual - expected);
            if (!(diff <= tol))
                Assert.Fail($"{label}: expected {expected:R}, got {actual:R} (|diff| {diff:R} > tol {tol:R})");
        }

        [Test]
        public void FrictionFactor_MatchesJavaScript()
        {
            var cases = Cases("frictionFactor");
            Assert.Multiple(() =>
            {
                for (int i = 0; i < cases.Count; i++)
                {
                    double[] a = Args(cases[i]);
                    AssertClose(D(cases[i]["expected"]), _hy.FrictionFactor(a[0], a[1]), $"frictionFactor case {i}");
                }
            });
        }

        [Test]
        public void PenstockLoss_MatchesJavaScript()
        {
            var cases = Cases("penstockLoss");
            Assert.Multiple(() =>
            {
                for (int i = 0; i < cases.Count; i++)
                {
                    double[] a = Args(cases[i]);
                    var e = (JObject)cases[i]["expected"];
                    var r = _hy.PenstockLoss(a[0], a[1], a[2], a[3], a[4]);
                    string l = $"penstockLoss case {i}";
                    AssertClose(D(e["A_pipe"]), r.A_pipe, l + " A_pipe");
                    AssertClose(D(e["v"]), r.v, l + " v");
                    AssertClose(D(e["Re"]), r.Re, l + " Re");
                    AssertClose(D(e["f"]), r.f, l + " f");
                    AssertClose(D(e["Hf_major"]), r.Hf_major, l + " Hf_major");
                    AssertClose(D(e["Hf_minor"]), r.Hf_minor, l + " Hf_minor");
                    AssertClose(D(e["Hf"]), r.Hf, l + " Hf");
                    Assert.That(r.lowRe, Is.EqualTo(e["lowRe"].Value<bool>()), l + " lowRe");
                }
            });
        }

        [Test]
        public void TurbinePower_MatchesJavaScript()
        {
            var cases = Cases("turbinePower");
            Assert.Multiple(() =>
            {
                for (int i = 0; i < cases.Count; i++)
                {
                    double[] a = Args(cases[i]);
                    AssertClose(D(cases[i]["expected"]), _hy.TurbinePower(a[0], a[1], a[2]), $"turbinePower case {i}");
                }
            });
        }

        [Test]
        public void PumpPower_MatchesJavaScript()
        {
            var cases = Cases("pumpPower");
            Assert.Multiple(() =>
            {
                for (int i = 0; i < cases.Count; i++)
                {
                    double[] a = Args(cases[i]);
                    AssertClose(D(cases[i]["expected"]), _hy.PumpPower(a[0], a[1], a[2]), $"pumpPower case {i}");
                }
            });
        }
    }
}
