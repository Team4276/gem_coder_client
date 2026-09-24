---
name: 4276-subsystem-code
description: Write, extend, or review WPILib subsystem code for Team 4276's robot, following the MotorSubsystem/ServoMotorSubsystem/FlywheelMotorSubsystem base-class architecture (singleton subsystems, MotorIO hardware abstraction, per-subsystem Constants classes, Setpoint pattern, Mode-based real/sim/replay branching). Use whenever the user asks to add a new subsystem or mechanism, write or update a Constants file, add a Setpoint, add homing logic, or debug/review an existing subsystem against these conventions.
---

# Team 4276 Subsystem Code

Robot code is built on a shared inheritance chain, not raw `SubsystemBase`. Don't fall back to generic WPILib patterns (public constructors, standalone Command classes, raw doubles for physical units) that don't match this codebase.

## Architecture

```
SubsystemBase
  └── MotorSubsystem<IO extends MotorIO>          (frc.lib.bases) — any motorized subsystem
        ├── ServoMotorSubsystem<IO>                (frc.lib.bases) — precise position control + homing
        └── FlywheelMotorSubsystem<IO>              (frc.lib.bases) — precise velocity control
              └── [YourSubsystem]                  (frc.robot.subsystems.[name]) — concrete
```

- **`MotorIO`** is the hardware-abstraction layer — concrete subsystems only call methods on `io`, never CTRE/REV APIs directly. This is what lets real hardware and sim share one subsystem class.
- Pick **`MotorSubsystem`** directly for a mechanism with no precision requirement (e.g. a simple roller). Pick **`ServoMotorSubsystem`** for target *position* (arms, hoods, elevators — adds `nearPosition`, homing, position-wait commands). Pick **`FlywheelMotorSubsystem`** for target *velocity* (shooters, flywheels — adds `nearVelocity`, debounced velocity checks).
- Read `references/base-classes.md` before writing code against any base class — don't guess at what's inherited or reimplement something already provided (e.g. never write a custom `Command` for "go to setpoint," use `setpointCommand()`).
- All three base classes take a `tuningMode` boolean — when true and the robot is disabled, PID gains become live-tunable via `TunableNumber`/SmartDashboard. Pass `true` only for a subsystem actively being tuned, not by default.

## Writing a new subsystem

Package: `frc.robot.subsystems.[name]` (lowercase), containing exactly two files: `[Name].java` and `[Name]Constants.java`.

**`[Name].java` structure** — follow this order:

1. Named `Setpoint` constants, built via `Setpoint.with*Setpoint(...)` factory methods (e.g. `withMotionMagicSetpoint`, `withVelocitySetpoint`, `withVoltageSetpoint` — check `references/base-classes.md` for the full list before assuming one exists)
2. Singleton instance: `public static final [Name] mInstance = new [Name]();`
3. Public (this repo does not privatize subsystem constructors — see `ExampleSubsystem.java`) constructor calling `super(...)` with the IO, name, and any epsilon/tuning/homing args the chosen base class needs
4. If the mechanism needs homing (has to find a zero via a hard stop), pass a `ServoMotorSubsystem.ServoHomingConfig` via the homing-overload `super(...)` — see `references/base-classes.md` for the config fields (`kHomePosition`, `kHomingVoltage`, `kHomingTimeout`, `kSetHomedVelocity`).

Use `assets/subsystem-template.java` as the starting skeleton.

**`[Name]Constants.java` structure** — a Constants class is also a small object factory:

- Raw constants with `k` prefix, using WPILib `Units` types (`Angle`, `Voltage`, `AngularVelocity`, etc.) — **never raw `double`s** for physical quantities except unitless things like gearing
- `getFXConfig()` — builds and returns the `TalonFXConfiguration` (current limits, `Voltage.PeakForward/ReverseVoltage`, `Feedback.SensorToMechanismRatio`, `MotorOutput.Inverted`). Gate current-limit enables with `Robot.isReal()` (see `ExampleSubsystemConstants.getFXConfig()`).
- `getIOConfig()` — builds a `MotorIOTalonFXConfig` with `unit`, `time`, `mainID`/`mainBus` sourced from `Ports.[NAME]`
- `getSimConstants()` — returns the matching sim-constants object (`RollerSim.RollerSimConstants` for rollers/flywheels, `PivotSim` for arms/pivots, `LinearSim` for elevators) with `motor`, `gearing`, `momentOfInertia`
- `getMotorIO()` — **branches on `RobotConstants.mode` with a `switch`, not `Robot.isReal()`**:
  ```java
  public static MotorIO getMotorIO() {
      return switch (RobotConstants.mode) {
          case REAL -> new MotorIOTalonFX(getIOConfig());
          case SIM -> new MotorIOTalonFXSim(getIOConfig(), new RollerSim(getSimConstants()));
          case REPLAY -> new MotorIO(Units.Rotations, Units.Minutes) {
              @Override public void updateInputs() {};
          };
      };
  }
  ```
  Every subsystem needs all three branches, including REPLAY — don't skip it even if the user only asked about real hardware.

Use `assets/constants-template.java` as the starting skeleton.

This repo has **no practice-bot/comp-bot value split** — don't invent one (unlike some other teams' codebases). `RobotConstants.getType()` (COMPBOT/SIMBOT) exists but isn't used for constant branching in the current examples; don't add that pattern unless the user asks for it.

**Ask the user rather than guessing** for anything hardware-specific: CAN ID / bus (add an entry to the `Ports` enum in `frc.robot.Ports`, e.g. `MY_SUBSYSTEM(id, RobotConstants.rio)`), actual gear ratios, current limits, and PID gains. These come from mechanical/electrical design, not convention.

## Naming conventions

| Prefix | Meaning | Example |
|---|---|---|
| `k` | Constant | `kExampleVoltage`, `kGearing` |
| `m` | Private instance field | `mInstance`, `mHoming` |
| `get*` | Factory or accessor method | `getMotorIO()`, `getPosition()` |

## Commands

Prefer the base class's built-in command builders over writing new `Command` classes:

- `setpointCommand(setpoint)` — one-shot, goes to a setpoint
- `followSetpointCommand(supplier)` — continuous, follows a changing setpoint
- `waitForPositionCommand(position)` / `setpointCommandWithWait(setpoint)` — sequencing (ServoMotorSubsystem only)
- `enableCommand()` / `disableCommand()`

Multi-subsystem coordination (sequencing several subsystems for a game action) belongs in `frc.robot.subsystems.superstructure.Superstructure`, not scattered across individual subsystems — see `Superstructure.java` for the `.finallyDo(...)` idle-return pattern used there.

Only write a standalone `Command` class when logic genuinely doesn't fit a base-class builder or the Superstructure pattern — check `references/base-classes.md` first.

## Reviewing/debugging existing code

Check against every section above — particularly: is `getMotorIO()` switching on `RobotConstants.mode` with all three cases, does the Constants class use `Units` types instead of raw doubles, is the CAN ID pulled from the `Ports` enum rather than hardcoded, and (for Servo/Flywheel subsystems) is the epsilon threshold and any homing config passed correctly to `super(...)`.
