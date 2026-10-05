/**
 * PascoBot - High-level robotics interface
 *
 * Extends ControlNodeDevice with simplified drive and turn commands
 * for wheeled robot control.
 */

import { ControlNodeDevice } from './control-node-device.js';

/**
 * PascoBot class
 *
 * Provides high-level robotics interface for PASCO wheeled robot.
 */
export class PascoBot extends ControlNodeDevice {
  /** Wheel radius in centimeters */
  protected static readonly WHEEL_RADIUS = 3.7;

  /** Wheel base scale factor for turning */
  protected static readonly WHEEL_BASE_SCALE = 6.1 / 3.7;

  /**
   * Drive at a given speed
   * @param speed Speed in cm/second
   * @param acceleration Acceleration in cm/s/s
   */
  async drive(speed: number, acceleration: number): Promise<void> {
    const wheelCircumference = 2 * Math.PI * PascoBot.WHEEL_RADIUS;

    // Convert cm/s to deg/s
    const degSpeed = (speed * 360) / wheelCircumference;
    const degAcceleration = (acceleration * 360) / wheelCircumference;

    // Wheels rotate in opposite directions for forward motion
    await this.rotateSteppersContinuously(-degSpeed, degAcceleration, degSpeed, degAcceleration);
  }

  /**
   * Turn by a given angle
   * @param angle Angle to turn in degrees (positive = right, negative = left)
   * @param velocity Turn velocity in deg/s (default: 180)
   */
  async turn(angle: number, velocity: number = 180): Promise<void> {
    const scale = PascoBot.WHEEL_BASE_SCALE;
    const sign = angle >= 0 ? 1 : -1;
    const scaledAngle = scale * Math.abs(angle);
    const scaledVelocity = velocity * scale;

    await this.rotateSteppersThrough(
      sign * scaledVelocity,
      Math.abs(sign * 360),
      scaledAngle,
      sign * scaledVelocity,
      Math.abs(sign * 360),
      scaledAngle,
      true, // await completion
    );
  }

  /**
   * Turn continuously at a given angular velocity
   * @param angularVelocity Angular velocity in deg/s (positive = right, negative = left)
   */
  async turnContinuous(angularVelocity: number): Promise<void> {
    const scaledAv = angularVelocity * PascoBot.WHEEL_BASE_SCALE;
    const acceleration = Math.abs(scaledAv) / 2;

    await this.rotateSteppersContinuously(scaledAv, acceleration, scaledAv, acceleration);
  }

  /**
   * Stop the robot
   * @param acceleration Deceleration rate in deg/s/s (default: 360)
   */
  async stop(acceleration: number = 360): Promise<void> {
    await this.stopSteppers(acceleration, acceleration);
  }
}
