package frc.robot.subsystems.[name];

import frc.lib.bases.ServoMotorSubsystem;
import frc.lib.io.MotorIO;
import frc.lib.io.MotorIO.Setpoint;

// Swap ServoMotorSubsystem<MotorIO> for MotorSubsystem<MotorIO> (plain mechanism)
// or FlywheelMotorSubsystem<MotorIO> (velocity-controlled) as needed.
public class [Name] extends ServoMotorSubsystem<MotorIO> {
    // Named setpoints first, built from *Constants values.
    public static final Setpoint STOWED = Setpoint.withMotionMagicSetpoint([Name]Constants.kStowedPosition);
    public static final Setpoint DEPLOYED = Setpoint.withMotionMagicSetpoint([Name]Constants.kDeployedPosition);

    // Singleton instance.
    public static final [Name] mInstance = new [Name]();

    public [Name]() {
        super(
                [Name]Constants.getMotorIO(),
                "[Name]",
                [Name]Constants.kEpsilonThreshold);
        // For a homing subsystem, instead call:
        // super([Name]Constants.getMotorIO(), "[Name]", [Name]Constants.kEpsilonThreshold,
        //       [Name]Constants.getServoHomingConfig());
    }
}
