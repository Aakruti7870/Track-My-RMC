package com.trackmyrmc.driver;

import java.time.LocalDate;

/** Standalone Java smoke test: javac -d out DriverIdentityContract*.java && java -cp out com.trackmyrmc.driver.DriverIdentityContractTest */
public final class DriverIdentityContractTest {
    public static void main(String[] args) {
        DriverIdentityContract profile = new DriverIdentityContract("emp-001", LocalDate.of(2022,8,15), 102, "O+");
        if (!"EMP-001".equals(profile.employeeId())) throw new AssertionError("ID normalisation");
        if (!"8 Years 6 Months".equals(profile.experienceDisplay())) throw new AssertionError("Experience conversion");
        if (!"Not provided".equals(new DriverIdentityContract(null,null,null,null).experienceDisplay()))
            throw new AssertionError("Null handling");
        try {
            new DriverIdentityContract("BAD #", LocalDate.now(), -1, "X");
            throw new AssertionError("Invalid profile accepted");
        } catch (IllegalArgumentException expected) {
            // Rejected.
        }
        System.out.println("PASS: DriverIdentityContract");
    }
}
