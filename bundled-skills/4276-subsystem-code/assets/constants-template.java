package frc.robot.subsystems.[name];

import com.ctre.phoenix6.configs.TalonFXConfiguration;
import com.ctre.phoenix6.signals.InvertedValue;

import edu.wpi.first.math.system.plant.DCMotor;
import edu.wpi.first.units.Units;
import edu.wpi.first.units.measure.Angle;
import frc.lib.bases.ServoMotorSubsystem.ServoHomingConfig;
import frc.lib.io.MotorIO;
import frc.lib.io.MotorIO.MotorIOTalonFXConfig;
import frc.lib.io.MotorIOTalonFX;
import frc.lib.io.MotorIOTalonFXSim;
import frc.lib.sim.PivotSim;
import frc.lib.sim.PivotSim.PivotSimConstants; // swap for RollerSim/LinearSim as fits the mechanism
import frc.robot.Ports;
import frc.robot.Robot;
import frc.robot.RobotConstants;

public class [Name]Constants {
    // Ask the user for real values — do not invent gearing, CAN IDs, or gains.
    public static final double kGearing = 1.0;
    public static final Angle kStowedPosition = Units.Rotations.of(0.0);
    public static final Angle kDeployedPosition = Units.Rotations.of(0.25);
    public static final Angle kEpsilonThreshold = Units.Rotations.of(0.02);

    public static TalonFXConfiguration getFXConfig() {
        TalonFXConfiguration config = new TalonFXConfiguration();

        config.CurrentLimits.StatorCurrentLimitEnable = Robot.isReal();
        config.CurrentLimits.StatorCurrentLimit = 80.0;

        config.CurrentLimits.SupplyCurrentLimitEnable = Robot.isReal();
        config.CurrentLimits.SupplyCurrentLimit = 50.0;
        config.CurrentLimits.SupplyCurrentLowerLimit = 50.0;
        config.CurrentLimits.SupplyCurrentLowerTime = 0.1;

        config.Voltage.PeakForwardVoltage = 12.0;
        config.Voltage.PeakReverseVoltage = -12.0;

        config.Feedback.SensorToMechanismRatio = kGearing;

        config.MotorOutput.Inverted = InvertedValue.Clockwise_Positive;

        return config;
    }

    public static MotorIOTalonFXConfig getIOConfig() {
        MotorIOTalonFXConfig config = new MotorIOTalonFXConfig();
        config.unit = Units.Rotations;
        config.time = Units.Minutes;
        config.mainID = Ports.[NAME].id;
        config.mainBus = Ports.[NAME].bus;
        return config;
    }

    public static MotorIO getMotorIO() {
        return switch (RobotConstants.mode) {
            case REAL -> new MotorIOTalonFX(getIOConfig());
            case SIM -> new MotorIOTalonFXSim(getIOConfig(), new PivotSim(getSimConstants()));
            case REPLAY -> new MotorIO(Units.Rotations, Units.Minutes) {
                @Override
                public void updateInputs() {
                }
            };
        };
    }

    public static PivotSimConstants getSimConstants() {
        PivotSimConstants simConstants = new PivotSimConstants();

        simConstants.motor = DCMotor.getKrakenX60(1);
        simConstants.gearing = kGearing;
        simConstants.momentOfInertia = 0.01;

        return simConstants;
    }

    // Only for a homing subsystem:
    public static ServoHomingConfig getServoHomingConfig() {
        ServoHomingConfig config = new ServoHomingConfig();
        config.kHomePosition = Units.Rotations.of(0.0);
        config.kHomingVoltage = Units.Volts.of(-1.0);
        config.kHomingTimeout = Units.Seconds.of(0.25);
        config.kSetHomedVelocity = Units.RotationsPerSecond.of(0.05);
        return config;
    }
}
