# Base class reference

## MotorIO (`frc.lib.io.MotorIO`)

Abstract hardware-abstraction layer. Concrete subsystems never call CTRE/REV APIs directly.

Key inherited/available methods (via `MotorSubsystem.io` or directly):
- `updateInputs()` — abstract, implemented per hardware (`MotorIOTalonFX`, `MotorIOTalonFXSim`, `MotorIOSparkMax`, `MotorIOSparkFlex`)
- `applySetpoint(Setpoint)`, `getSetpoint()`, `getSetpointDoubleInUnits()`
- `enable()` / `disable()` — setpoints can still be set while disabled; not applied until re-enabled
- `setCurrentPosition(Angle)`, `zeroSensors()`
- `useSoftLimits(boolean)`, `setNeutralBrake(boolean)`
- `getPosition()`, `getVelocity()`, `getStatorCurrent()`, `getSupplyCurrent()`, `getMotorVoltage()`
- `getMotorIOConfig()` / `getConfigFailed()`
- `changeMainConfig(UnaryOperator<TalonFXConfiguration>)`, `changeFollowerConfig(...)` — used internally by `MotorSubsystem.useTunableNumbers()` for live PID tuning

### `Mode` enum (control mode, not real/sim/replay — don't confuse with `RobotConstants.Mode`)
`IDLE, VOLTAGE, MOTIONMAGIC, VELOCITY, DUTY_CYCLE, POSITIONPID`
Helper predicates: `isPositionControl()` (MOTIONMAGIC/POSITIONPID), `isVelocityControl()` (VELOCITY), `isVoltageControl()` (VOLTAGE/DUTY_CYCLE), `isNeutralControl()` (IDLE).

### `Setpoint` factory methods (`MotorIO.Setpoint`)
Don't hand-construct a `Setpoint` — always use one of these:
- `withMotionMagicSetpoint(Angle)` / `withMotionMagicSetpoint(Angle, int slot)` / `withMotionMagicSetpointAndCurrentLimit(...)`
- `withPositionSetpoint(Angle)` / `withPositionSetpoint(Angle, int slot)`
- `withVelocitySetpoint(AngularVelocity)` / `withVelocitySetpoint(AngularVelocity, int slot)` / `withVelocitySetpointAndCurrentLimit(...)` / `withVelocitySetpointAndVoltageLimit(...)`
- `withVoltageSetpoint(Voltage)`
- `withDutyCycleSetpoint(Dimensionless)`
- `withNeutralSetpoint()`, `withCoastSetpoint()` — also available as constants `Setpoint.NEUTRAL`, `Setpoint.COAST`
- `withCustomSetpoint(UnaryOperator<MotorIO> applier, Mode mode, double baseUnits)` — escape hatch, use only when nothing above fits

## MotorSubsystem<IO> (`frc.lib.bases.MotorSubsystem`)

Base for any motorized subsystem.

Constructors: `MotorSubsystem(IO io, String name)` or `MotorSubsystem(IO io, String name, boolean tuningMode)`.

Inherited methods: `getPosition()`, `getVelocity()`, `getStatorCurrent()`, `getSupplyCurrent()`, `getMotorVoltage()`, `getSetpoint()`, `applySetpoint(Setpoint)`, `setpointCommand(Setpoint)`, `followSetpointCommand(Supplier<Setpoint>)`, `enable()`/`disable()`, `enableCommand()`/`disableCommand()`, `getIO()`, `outputTelemetry()` (override to add SmartDashboard/AdvantageKit outputs).

When `tuningMode == true` and the robot is disabled, `periodic()` auto-builds `TunableNumber`s for Slot0/1/2 PID gains (`kP0..kG2` etc.) and pushes changes back into the IO's TalonFX config live. Only set `tuningMode = true` for a subsystem currently being tuned.

## ServoMotorSubsystem<IO> extends MotorSubsystem<IO>

For position-controlled mechanisms (arms, hoods, elevators).

Constructors:
- Non-homing: `ServoMotorSubsystem(IO io, String name, Angle epsilonThreshold[, boolean tuningMode])`
- Homing: `ServoMotorSubsystem(IO io, String name, Angle epsilonThreshold[, boolean tuningMode], ServoHomingConfig config)`

Adds: `nearPosition(Angle)` / `nearPosition(Angle, Angle epsilon)`, `nearPositionSetpoint()`, `setpointNearHome()`, `nearHomingLocation()`, `waitForPositionCommand(Angle)`, `setpointCommandWithWait(Setpoint)`, `useSoftLimits(boolean)`, `setNeutralBrake(boolean)`, `setCurrentPosition(Angle)`.

`ServoHomingConfig` fields (static inner class): `kHomePosition` (Angle), `kHomingVoltage` (Voltage), `kHomingTimeout` (Time), `kSetHomedVelocity` (AngularVelocity). Homing logic runs automatically in `periodic()`: drives at `kHomingVoltage` toward the hard stop, waits for velocity to settle below `kSetHomedVelocity` for the timeout window, then zeroes and re-enables soft limits.

## FlywheelMotorSubsystem<IO> extends MotorSubsystem<IO>

For velocity-controlled mechanisms (shooters, flywheels).

Constructor: `FlywheelMotorSubsystem(IO io, String name, AngularVelocity epsilonThreshold, Time debounceTime[, boolean tuningMode])`.

Adds: `nearVelocity(AngularVelocity)` / `nearVelocity(AngularVelocity, AngularVelocity epsilon)`, `nearSetpointVelocity(Setpoint)` (debounced via internal `Debouncer`).

## Sim helpers (`frc.lib.sim`)

- `RollerSim` / `RollerSim.RollerSimConstants` — for rollers/flywheels/intakes (motor, gearing, momentOfInertia)
- `PivotSim` / `PivotSimHelper` — for arms/pivots (adds hard-stop and gravity modeling)
- `LinearSim` — for elevators/linear mechanisms
- `MechanismSim` — shared base interface these implement

Pick the sim class matching the mechanism's physical motion, and wire it into `getMotorIO()`'s `case SIM ->` branch via `MotorIOTalonFXSim(config, sim)`.

## Ports (`frc.robot.Ports`)

Enum, not a class of constants: `EXAMPLE_SUBSYSTEM(8, RobotConstants.rio)`. Each entry has `.id` (int) and `.bus` (CANBus — use `RobotConstants.rio` or `RobotConstants.canivore1`). Add a new enum entry for each new subsystem's motor(s).

## RobotConstants (`frc.robot.RobotConstants`)

- `RobotConstants.mode` — static field of `Mode {REAL, SIM, REPLAY}`, switch on this in `getMotorIO()`, not `Robot.isReal()`
- `RobotConstants.getType()` — `RobotType {COMPBOT, SIMBOT}`, derived from `mode`; not currently used to branch constants, don't add that pattern speculatively
- `RobotConstants.isTuning` — global tuning flag (separate from per-subsystem `tuningMode`)

## Superstructure (`frc.robot.subsystems.superstructure.Superstructure`)

Singleton (`Superstructure.mInstance`) `SubsystemBase` that composes multiple subsystems' commands for game actions (e.g. intake-then-idle sequences). Pattern: build a `Command` chaining subsystem `setpointCommand(...)` calls, use `.finallyDo(() -> ...)` to return subsystems to an idle setpoint on interrupt/completion, and `.withName("...")` for logging. Put cross-subsystem coordination logic here, not in individual subsystem classes.
