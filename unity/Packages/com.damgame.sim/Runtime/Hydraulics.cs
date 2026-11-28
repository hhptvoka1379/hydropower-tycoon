// C# port of src/sim/hydraulics.js (frictionFactor, penstockLoss, turbinePower, pumpPower).
// Pure, SI units, no engine references. The JavaScript is the reference implementation.
using System;

namespace DamGame.Sim
{
    /// <summary>Constants from CONFIG.physics (Rho, G, Nu) and CONFIG.hydraulics.</summary>
    public sealed record HydraulicsConstants(
        double Rho,
        double G,
        double Nu,
        double SwameeA,
        double SwameeB,
        double SwameeExp,
        double FMin,
        double FMax,
        double ReTurbulent,
        double FLowRe);

    /// <summary>Result of <see cref="Hydraulics.PenstockLoss"/>, fields in the JavaScript order.</summary>
    public sealed record PenstockLossResult(
        double A_pipe,
        double v,
        double Re,
        double f,
        double Hf_major,
        double Hf_minor,
        double Hf,
        bool lowRe);

    public sealed class Hydraulics
    {
        private readonly HydraulicsConstants _c;

        public Hydraulics(HydraulicsConstants constants)
        {
            _c = constants ?? throw new ArgumentNullException(nameof(constants));
        }

        public HydraulicsConstants Constants => _c;

        /// <summary>Swamee–Jain friction factor (§2.2), clamped to [f_min, f_max]; 0 &lt; Re &lt; Re_turbulent → f_lowRe.</summary>
        public double FrictionFactor(double Re, double relRough)
        {
            if (!(Re > 0)) return 0;
            if (Re < _c.ReTurbulent) return _c.FLowRe;
            double arg = Math.Max(relRough / _c.SwameeA + _c.SwameeB / Math.Pow(Re, _c.SwameeExp), 1e-12);
            double lg = Math.Log10(arg);
            double den = lg * lg;
            double f = den > 0 ? 0.25 / den : _c.FMax;
            return Math.Min(_c.FMax, Math.Max(_c.FMin, f));
        }

        /// <summary>Penstock friction, Darcy–Weisbach plus minor losses (§2.2). Q_pen = 0 → all zero.</summary>
        public PenstockLossResult PenstockLoss(double Q_pen, double D, double L, double epsilon, double sumK)
        {
            double A_pipe = Math.PI * Math.Pow(D / 2, 2);
            if (!(Q_pen > 0) || !(D > 0)) return new PenstockLossResult(A_pipe, 0, 0, 0, 0, 0, 0, false);
            double v = Q_pen / A_pipe;
            double Re = v * D / _c.Nu;
            double f = FrictionFactor(Re, epsilon / D);
            double vh = v * v / (2 * _c.G);
            double Hf_major = f * (L / D) * vh;
            double Hf_minor = sumK * vh;
            return new PenstockLossResult(A_pipe, v, Re, f, Hf_major, Hf_minor, Hf_major + Hf_minor, Re < _c.ReTurbulent);
        }

        /// <summary>Turbine power P = ρ g H_n Q η (§2.4); H_n ≤ 0 or Q ≤ 0 → 0.</summary>
        public double TurbinePower(double H_n, double Q, double eta)
        {
            if (!(H_n > 0) || !(Q > 0)) return 0;
            return _c.Rho * _c.G * H_n * Q * eta;
        }

        /// <summary>Pump power P = ρ g max(H_dyn, 0) Q / η (§2.5); Q ≤ 0 or η ≤ 0 → 0.</summary>
        public double PumpPower(double H_dyn, double Q, double eta)
        {
            if (!(Q > 0) || !(eta > 0)) return 0;
            return _c.Rho * _c.G * Math.Max(H_dyn, 0) * Q / eta;
        }
    }
}
